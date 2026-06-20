package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

const (
	maxUploadSize    = 20 << 20 // 20 MB
	todeletePrefix   = "TODELETE/"
	legacyPrefix     = "legacy/"
	originalMetaKey  = "origname" // S3 user metadata key (lowercase, AWS lowercases anyway)
	uploadedAtMetaKey = "uploadedat"
)

// ImageMeta is the JSON shape returned to the frontend.
type ImageMeta struct {
	ID         string `json:"id"`         // R2 object key, e.g. "2026-06/abc123.jpg"
	Key        string `json:"key"`        // same as ID
	Month      string `json:"month"`      // "2026-06" or "TODELETE/2026-06" or "legacy"
	Archived   bool   `json:"archived"`   // true if under TODELETE/
	FileName   string `json:"fileName"`   // basename of key, e.g. "abc123.jpg"
	OrigName   string `json:"origName"`   // original upload filename (best-effort, may be empty)
	URL        string `json:"url"`        // public URL
	Size       int64  `json:"size"`
	UploadedAt string `json:"uploadedAt"` // ISO 8601
}

type MonthStat struct {
	Month    string `json:"month"`    // "2026-06" or "TODELETE/2026-06"
	Archived bool   `json:"archived"`
	Count    int    `json:"count"`
	Bytes    int64  `json:"bytes"`
}

func randomID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func writeJSON(w http.ResponseWriter, v any, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// monthFromKey extracts the month prefix from an object key.
//
//	"2026-06/abc123.jpg"          -> "2026-06"
//	"TODELETE/2026-06/abc123.jpg" -> "TODELETE/2026-06"
//	"legacy/old.jpg"              -> "legacy"
func monthFromKey(key string) string {
	parts := strings.SplitN(key, "/", 3)
	if len(parts) >= 3 && parts[0] == "TODELETE" {
		return parts[0] + "/" + parts[1]
	}
	if len(parts) >= 2 {
		return parts[0]
	}
	return ""
}

func currentMonth() string {
	return time.Now().UTC().Format("2006-01")
}

// R2 wraps the S3 client + config we need.
type R2 struct {
	client     *s3.Client
	bucket     string
	publicBase string
}

func mustEnv(k string) string {
	v := os.Getenv(k)
	if v == "" {
		log.Fatalf("required env var %s is missing", k)
	}
	return v
}

func newR2(ctx context.Context) *R2 {
	accountID := mustEnv("R2_ACCOUNT_ID")
	accessKey := mustEnv("R2_ACCESS_KEY_ID")
	secretKey := mustEnv("R2_SECRET_ACCESS_KEY")
	bucket := mustEnv("R2_BUCKET")
	publicBase := strings.TrimRight(mustEnv("R2_PUBLIC_BASE"), "/")
	endpoint := os.Getenv("R2_ENDPOINT")
	if endpoint == "" {
		endpoint = fmt.Sprintf("https://%s.r2.cloudflarestorage.com", accountID)
	}

	cfg, err := config.LoadDefaultConfig(ctx,
		config.WithRegion("auto"),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKey, secretKey, "")),
	)
	if err != nil {
		log.Fatalf("aws config: %v", err)
	}
	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(endpoint)
		o.UsePathStyle = false
	})
	return &R2{client: client, bucket: bucket, publicBase: publicBase}
}

func (r *R2) publicURL(key string) string {
	return r.publicBase + "/" + key
}

func (r *R2) put(ctx context.Context, key string, body io.Reader, contentType string, meta map[string]string) error {
	_, err := r.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(r.bucket),
		Key:         aws.String(key),
		Body:        body,
		ContentType: aws.String(contentType),
		Metadata:    meta,
	})
	return err
}

func (r *R2) delete(ctx context.Context, key string) error {
	_, err := r.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(key),
	})
	return err
}

// copyAndDelete moves an object from src key to dst key (S3 has no rename).
func (r *R2) move(ctx context.Context, src, dst string) error {
	_, err := r.client.CopyObject(ctx, &s3.CopyObjectInput{
		Bucket:     aws.String(r.bucket),
		Key:        aws.String(dst),
		CopySource: aws.String(r.bucket + "/" + src),
	})
	if err != nil {
		return err
	}
	return r.delete(ctx, src)
}

// listAll paginates ListObjectsV2 across the entire bucket (no delimiter).
func (r *R2) listAll(ctx context.Context, prefix string) ([]types.Object, error) {
	out := []types.Object{}
	var token *string
	for {
		resp, err := r.client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
			Bucket:            aws.String(r.bucket),
			Prefix:            aws.String(prefix),
			ContinuationToken: token,
		})
		if err != nil {
			return nil, err
		}
		out = append(out, resp.Contents...)
		if resp.IsTruncated == nil || !*resp.IsTruncated {
			return out, nil
		}
		token = resp.NextContinuationToken
	}
}

// headOrigName fetches the original filename from user metadata. Best-effort.
func (r *R2) headOrigName(ctx context.Context, key string) string {
	resp, err := r.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(key),
	})
	if err != nil || resp.Metadata == nil {
		return ""
	}
	return resp.Metadata[originalMetaKey]
}

func (r *R2) toMeta(obj types.Object, origName string) ImageMeta {
	key := aws.ToString(obj.Key)
	month := monthFromKey(key)
	archived := strings.HasPrefix(month, "TODELETE/")
	uploaded := ""
	if obj.LastModified != nil {
		uploaded = obj.LastModified.UTC().Format(time.RFC3339)
	}
	size := int64(0)
	if obj.Size != nil {
		size = *obj.Size
	}
	name := filepath.Base(key)
	if origName == "" {
		origName = name
	}
	return ImageMeta{
		ID:         key,
		Key:        key,
		Month:      month,
		Archived:   archived,
		FileName:   name,
		OrigName:   origName,
		URL:        r.publicURL(key),
		Size:       size,
		UploadedAt: uploaded,
	}
}

func main() {
	ctx := context.Background()
	r2 := newR2(ctx)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	mux := http.NewServeMux()

	// ── POST /api/upload ─────────────────────────────────────────────
	// Uploads an image to R2 under YYYY-MM/uuid.ext.
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

		ext := strings.ToLower(filepath.Ext(header.Filename))
		if ext == "" {
			ext = ".jpg"
		}
		contentType := header.Header.Get("Content-Type")
		if contentType == "" {
			contentType = "image/jpeg"
		}

		id := randomID()
		key := currentMonth() + "/" + id + ext
		meta := map[string]string{
			originalMetaKey:   header.Filename,
			uploadedAtMetaKey: time.Now().UTC().Format(time.RFC3339),
		}

		if err := r2.put(r.Context(), key, file, contentType, meta); err != nil {
			log.Printf("r2 put: %v", err)
			http.Error(w, "upload failed", http.StatusInternalServerError)
			return
		}

		out := ImageMeta{
			ID:         key,
			Key:        key,
			Month:      currentMonth(),
			Archived:   false,
			FileName:   id + ext,
			OrigName:   header.Filename,
			URL:        r2.publicURL(key),
			Size:       header.Size,
			UploadedAt: time.Now().UTC().Format(time.RFC3339),
		}
		writeJSON(w, out, http.StatusCreated)
	})

	// ── GET /api/images ──────────────────────────────────────────────
	// Lists every object in the bucket. Frontend groups by Month / Archived.
	// Optional query: ?prefix=2026-06 to filter (raw prefix, no leading slash).
	mux.HandleFunc("GET /api/images", func(w http.ResponseWriter, r *http.Request) {
		prefix := r.URL.Query().Get("prefix")
		objs, err := r2.listAll(r.Context(), prefix)
		if err != nil {
			log.Printf("r2 list: %v", err)
			http.Error(w, "list failed", http.StatusInternalServerError)
			return
		}
		out := make([]ImageMeta, 0, len(objs))
		for _, o := range objs {
			// origName fetch is too expensive at list time (one HEAD per object).
			// Frontend can call /api/image?key=... for detail if needed.
			out = append(out, r2.toMeta(o, ""))
		}
		sort.Slice(out, func(i, j int) bool { return out[i].UploadedAt > out[j].UploadedAt })
		writeJSON(w, out, http.StatusOK)
	})

	// ── GET /api/months ──────────────────────────────────────────────
	// Returns monthly object counts + bytes so the UI can show a folder list.
	mux.HandleFunc("GET /api/months", func(w http.ResponseWriter, r *http.Request) {
		objs, err := r2.listAll(r.Context(), "")
		if err != nil {
			http.Error(w, "list failed", http.StatusInternalServerError)
			return
		}
		byMonth := map[string]*MonthStat{}
		for _, o := range objs {
			m := monthFromKey(aws.ToString(o.Key))
			if m == "" {
				continue
			}
			stat, ok := byMonth[m]
			if !ok {
				stat = &MonthStat{Month: m, Archived: strings.HasPrefix(m, "TODELETE/")}
				byMonth[m] = stat
			}
			stat.Count++
			if o.Size != nil {
				stat.Bytes += *o.Size
			}
		}
		out := make([]MonthStat, 0, len(byMonth))
		for _, s := range byMonth {
			out = append(out, *s)
		}
		sort.Slice(out, func(i, j int) bool { return out[i].Month < out[j].Month })
		writeJSON(w, out, http.StatusOK)
	})

	// ── GET /api/image?key=...  ──────────────────────────────────────
	// Returns full metadata for one object (includes user-metadata origName).
	mux.HandleFunc("GET /api/image", func(w http.ResponseWriter, r *http.Request) {
		key := r.URL.Query().Get("key")
		if key == "" {
			http.Error(w, "missing key", http.StatusBadRequest)
			return
		}
		head, err := r2.client.HeadObject(r.Context(), &s3.HeadObjectInput{
			Bucket: aws.String(r2.bucket),
			Key:    aws.String(key),
		})
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		origName := ""
		if head.Metadata != nil {
			origName = head.Metadata[originalMetaKey]
		}
		size := int64(0)
		if head.ContentLength != nil {
			size = *head.ContentLength
		}
		uploaded := ""
		if head.LastModified != nil {
			uploaded = head.LastModified.UTC().Format(time.RFC3339)
		}
		out := ImageMeta{
			ID: key, Key: key, Month: monthFromKey(key),
			Archived:   strings.HasPrefix(key, todeletePrefix),
			FileName:   filepath.Base(key),
			OrigName:   origName,
			URL:        r2.publicURL(key),
			Size:       size,
			UploadedAt: uploaded,
		}
		writeJSON(w, out, http.StatusOK)
	})

	// ── DELETE /api/image?key=...  ───────────────────────────────────
	// Permanently deletes a single object.
	mux.HandleFunc("DELETE /api/image", func(w http.ResponseWriter, r *http.Request) {
		key := r.URL.Query().Get("key")
		if key == "" {
			http.Error(w, "missing key", http.StatusBadRequest)
			return
		}
		if err := r2.delete(r.Context(), key); err != nil {
			log.Printf("r2 delete %s: %v", key, err)
			http.Error(w, "delete failed", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// ── POST /api/months/archive?month=2026-06 ───────────────────────
	// Moves every object under 2026-06/ to TODELETE/2026-06/.
	mux.HandleFunc("POST /api/months/archive", func(w http.ResponseWriter, r *http.Request) {
		month := r.URL.Query().Get("month")
		if month == "" || strings.HasPrefix(month, "TODELETE") || month == "legacy" {
			http.Error(w, "invalid month", http.StatusBadRequest)
			return
		}
		objs, err := r2.listAll(r.Context(), month+"/")
		if err != nil {
			http.Error(w, "list failed", http.StatusInternalServerError)
			return
		}
		moved := 0
		for _, o := range objs {
			src := aws.ToString(o.Key)
			dst := todeletePrefix + src
			if err := r2.move(r.Context(), src, dst); err != nil {
				log.Printf("archive move %s -> %s: %v", src, dst, err)
				continue
			}
			moved++
		}
		writeJSON(w, map[string]int{"moved": moved}, http.StatusOK)
	})

	// ── POST /api/months/restore?month=2026-06 ───────────────────────
	// Moves TODELETE/2026-06/* back to 2026-06/*.
	mux.HandleFunc("POST /api/months/restore", func(w http.ResponseWriter, r *http.Request) {
		month := r.URL.Query().Get("month")
		if month == "" {
			http.Error(w, "missing month", http.StatusBadRequest)
			return
		}
		srcPrefix := todeletePrefix + month + "/"
		objs, err := r2.listAll(r.Context(), srcPrefix)
		if err != nil {
			http.Error(w, "list failed", http.StatusInternalServerError)
			return
		}
		moved := 0
		for _, o := range objs {
			src := aws.ToString(o.Key)
			dst := strings.TrimPrefix(src, todeletePrefix)
			if err := r2.move(r.Context(), src, dst); err != nil {
				log.Printf("restore move %s -> %s: %v", src, dst, err)
				continue
			}
			moved++
		}
		writeJSON(w, map[string]int{"moved": moved}, http.StatusOK)
	})

	// ── DELETE /api/months/purge?month=2026-06 ───────────────────────
	// Permanently deletes every object under TODELETE/2026-06/.
	mux.HandleFunc("DELETE /api/months/purge", func(w http.ResponseWriter, r *http.Request) {
		month := r.URL.Query().Get("month")
		if month == "" {
			http.Error(w, "missing month", http.StatusBadRequest)
			return
		}
		prefix := todeletePrefix + month + "/"
		objs, err := r2.listAll(r.Context(), prefix)
		if err != nil {
			http.Error(w, "list failed", http.StatusInternalServerError)
			return
		}
		deleted := 0
		for _, o := range objs {
			if err := r2.delete(r.Context(), aws.ToString(o.Key)); err != nil {
				log.Printf("purge delete %s: %v", aws.ToString(o.Key), err)
				continue
			}
			deleted++
		}
		writeJSON(w, map[string]int{"deleted": deleted}, http.StatusOK)
	})

	// ── Serve built frontend ─────────────────────────────────────────
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join("./dist", filepath.Clean(r.URL.Path))
		if _, err := os.Stat(path); os.IsNotExist(err) {
			http.ServeFile(w, r, "./dist/index.html")
			return
		}
		http.FileServer(http.Dir("./dist")).ServeHTTP(w, r)
	})

	log.Printf("platform-listing-tool (R2 backend) listening on :%s  bucket=%s  publicBase=%s",
		port, r2.bucket, r2.publicBase)
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
