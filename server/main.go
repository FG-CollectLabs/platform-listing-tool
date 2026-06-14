package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	uploadsDir    = "./uploads"
	maxUploadSize = 20 << 20 // 20 MB
)

type ImageMeta struct {
	ID         string    `json:"id"`
	FileName   string    `json:"fileName"`
	OrigName   string    `json:"origName"`
	URL        string    `json:"url"`
	Size       int64     `json:"size"`
	UploadedAt time.Time `json:"uploadedAt"`
}

func randomID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

// metaPath returns the JSON sidecar path for a given image filename.
func metaPath(imageFile string) string {
	ext := filepath.Ext(imageFile)
	return filepath.Join(uploadsDir, strings.TrimSuffix(imageFile, ext)+".json")
}

func writeJSON(w http.ResponseWriter, v any, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func main() {
	if err := os.MkdirAll(uploadsDir, 0o755); err != nil {
		log.Fatal("failed to create uploads dir:", err)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	baseURL := strings.TrimRight(os.Getenv("BASE_URL"), "/")
	if baseURL == "" {
		baseURL = "http://localhost:" + port
	}

	mux := http.NewServeMux()

	// Upload a new image
	mux.HandleFunc("POST /api/upload", func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
		if err := r.ParseMultipartForm(maxUploadSize); err != nil {
			http.Error(w, "file too large (max 20 MB)", http.StatusRequestEntityTooLarge)
			return
		}
		file, header, err := r.FormFile("image")
		if err != nil {
			http.Error(w, "missing 'image' field", http.StatusBadRequest)
			return
		}
		defer file.Close()

		id := randomID()
		ext := strings.ToLower(filepath.Ext(header.Filename))
		if ext == "" {
			ext = ".jpg"
		}
		storedName := id + ext
		dst := filepath.Join(uploadsDir, storedName)

		out, err := os.Create(dst)
		if err != nil {
			log.Println("create file:", err)
			http.Error(w, "failed to save file", http.StatusInternalServerError)
			return
		}
		size, err := io.Copy(out, file)
		out.Close()
		if err != nil {
			os.Remove(dst)
			http.Error(w, "write error", http.StatusInternalServerError)
			return
		}

		meta := ImageMeta{
			ID:         id,
			FileName:   storedName,
			OrigName:   header.Filename,
			URL:        baseURL + "/uploads/" + storedName,
			Size:       size,
			UploadedAt: time.Now().UTC(),
		}

		// Write JSON sidecar so we can recover origName and uploadedAt on list
		if mf, err := os.Create(metaPath(storedName)); err == nil {
			json.NewEncoder(mf).Encode(meta)
			mf.Close()
		}

		writeJSON(w, meta, http.StatusCreated)
	})

	// List all images
	mux.HandleFunc("GET /api/images", func(w http.ResponseWriter, r *http.Request) {
		entries, err := os.ReadDir(uploadsDir)
		if err != nil {
			http.Error(w, "failed to read uploads dir", http.StatusInternalServerError)
			return
		}

		var metas []ImageMeta
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			name := e.Name()
			if filepath.Ext(name) == ".json" {
				continue // skip sidecar files
			}

			// Try to read sidecar for rich metadata
			var meta ImageMeta
			if mf, err := os.Open(metaPath(name)); err == nil {
				json.NewDecoder(mf).Decode(&meta)
				mf.Close()
			}
			// Fill in anything missing (e.g. sidecar lost)
			if meta.ID == "" {
				info, _ := e.Info()
				meta = ImageMeta{
					ID:         strings.TrimSuffix(name, filepath.Ext(name)),
					FileName:   name,
					OrigName:   name,
					UploadedAt: func() time.Time { if info != nil { return info.ModTime() }; return time.Now() }(),
					Size:       func() int64 { if info != nil { return info.Size() }; return 0 }(),
				}
			}
			meta.URL = baseURL + "/uploads/" + name
			metas = append(metas, meta)
		}

		sort.Slice(metas, func(i, j int) bool {
			return metas[i].UploadedAt.After(metas[j].UploadedAt)
		})

		writeJSON(w, metas, http.StatusOK)
	})

	// Delete an image by ID
	mux.HandleFunc("DELETE /api/images/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if id == "" {
			http.Error(w, "missing id", http.StatusBadRequest)
			return
		}

		entries, _ := os.ReadDir(uploadsDir)
		for _, e := range entries {
			name := e.Name()
			if filepath.Ext(name) == ".json" {
				continue
			}
			if strings.TrimSuffix(name, filepath.Ext(name)) == id {
				os.Remove(filepath.Join(uploadsDir, name))
				os.Remove(metaPath(name)) // remove sidecar
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		http.Error(w, "image not found", http.StatusNotFound)
	})

	// Serve uploaded image files
	mux.Handle("/uploads/",
		http.StripPrefix("/uploads/", http.FileServer(http.Dir(uploadsDir))))

	// Serve built frontend — fall back to index.html for SPA routing
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join("./dist", filepath.Clean(r.URL.Path))
		if _, err := os.Stat(path); os.IsNotExist(err) {
			http.ServeFile(w, r, "./dist/index.html")
			return
		}
		http.FileServer(http.Dir("./dist")).ServeHTTP(w, r)
	})

	log.Printf("platform-listing-tool listening on :%s  (base URL: %s)", port, baseURL)
	log.Fatal(http.ListenAndServe(":"+port, cors(mux)))
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
