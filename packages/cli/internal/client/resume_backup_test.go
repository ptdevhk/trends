package client

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestResumeBackupClientEndpoints(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/resumes/backup":
			if got := r.Header.Get("X-Workspace-Slug"); got != "hr" {
				t.Fatalf("expected workspace header hr, got %q", got)
			}

			var payload ResumeBackupRequest
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("failed to decode request body: %v", err)
			}
			if len(payload.ResumeIDs) != 2 || payload.ResumeIDs[0] != "r1" || payload.ResumeIDs[1] != "r2" {
				t.Fatalf("unexpected resume IDs: %+v", payload.ResumeIDs)
			}
			if len(payload.SourceHosts) != 1 || payload.SourceHosts[0] != "hr.job5156.com" {
				t.Fatalf("unexpected source hosts: %+v", payload.SourceHosts)
			}
			if payload.Limit != 2 {
				t.Fatalf("expected limit=2, got %d", payload.Limit)
			}

			w.Header().Set("Content-Disposition", `attachment; filename="resume-backup-test.json"`)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"metadata": map[string]any{
					"generatedBy": "trends-api backup",
				},
				"resumes": []map[string]any{
					{"resumeId": "r1"},
				},
			})
		case r.Method == http.MethodPost && r.URL.Path == "/api/resumes/import":
			if got := r.Header.Get("Content-Type"); got != "application/json" {
				t.Fatalf("expected JSON content type, got %q", got)
			}

			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("failed to decode import body: %v", err)
			}
			if _, ok := payload["metadata"].(map[string]any); !ok {
				t.Fatalf("expected metadata object in import payload: %+v", payload)
			}
			if resumes, ok := payload["resumes"].([]any); !ok || len(resumes) != 1 {
				t.Fatalf("expected resumes array in import payload: %+v", payload)
			}

			_ = json.NewEncoder(w).Encode(ResumeSubmitSummary{
				Success:   true,
				Submitted: 1,
				Inserted:  1,
				Updated:   0,
				Unchanged: 0,
				Deduped:   0,
			})
		case r.Method == http.MethodPost && r.URL.Path == "/api/resumes/reset":
			_ = json.NewEncoder(w).Encode(ResumeResetResponse{
				Success: true,
				Count:   2,
				Partial: false,
				Deleted: map[string]int{"resumes": 2},
			})
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	c := New(server.URL, server.URL, "hr")
	c.HTTP = server.Client()

	backupPayload, disposition, err := c.BackupResumes(context.Background(), ResumeBackupRequest{
		ResumeIDs:   []string{"r1", "r2"},
		SourceHosts: []string{"hr.job5156.com"},
		Limit:       2,
	})
	if err != nil {
		t.Fatalf("BackupResumes returned error: %v", err)
	}
	if !json.Valid(backupPayload) {
		t.Fatalf("expected JSON backup payload, got %q", string(backupPayload))
	}
	if disposition == "" {
		t.Fatal("expected content-disposition header")
	}

	importSummary, err := c.ImportResumeBackup(context.Background(), json.RawMessage(`{
  "metadata": {
    "generatedBy": "trends-api backup"
  },
  "resumes": [
    {
      "resumeId": "r1",
      "name": "Alice"
    }
  ]
}`))
	if err != nil {
		t.Fatalf("ImportResumeBackup returned error: %v", err)
	}
	if importSummary.Submitted != 1 || !importSummary.Success {
		t.Fatalf("unexpected import summary: %+v", importSummary)
	}

	resetSummary, err := c.ResetResumes(context.Background())
	if err != nil {
		t.Fatalf("ResetResumes returned error: %v", err)
	}
	if resetSummary.Count != 2 || resetSummary.Partial {
		t.Fatalf("unexpected reset summary: %+v", resetSummary)
	}
}

func TestResumeBackupAllowsFullSnapshotToExceedDefaultClientTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/resumes/backup" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		time.Sleep(100 * time.Millisecond)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"metadata": map[string]any{"generatedBy": "trends-api backup"},
			"resumes":  []map[string]any{},
		})
	}))
	defer server.Close()

	c := New(server.URL, server.URL, "dev")
	c.HTTP = &http.Client{Timeout: 10 * time.Millisecond}

	if _, _, err := c.BackupResumes(context.Background(), ResumeBackupRequest{}); err != nil {
		t.Fatalf("full resume backup should use its extended request timeout: %v", err)
	}
}

func TestResumeBackupKeepsDefaultTimeoutForTargetedBackup(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/resumes/backup" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		time.Sleep(100 * time.Millisecond)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"metadata": map[string]any{"generatedBy": "trends-api backup"},
			"resumes":  []map[string]any{},
		})
	}))
	defer server.Close()

	c := New(server.URL, server.URL, "dev")
	c.HTTP = &http.Client{Timeout: 10 * time.Millisecond}

	if _, _, err := c.BackupResumes(context.Background(), ResumeBackupRequest{Limit: 1}); err == nil {
		t.Fatal("targeted resume backup should retain the caller's default timeout")
	}
}

func TestImportManualResumesUploadsMultipartForm(t *testing.T) {
	uploadPath := filepath.Join(t.TempDir(), "51job.rar")
	if err := os.WriteFile(uploadPath, []byte("rar-bytes"), 0o644); err != nil {
		t.Fatalf("failed to write upload file: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/resumes/manual-import" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("X-Workspace-Slug"); got != "hr" {
			t.Fatalf("expected workspace header hr, got %q", got)
		}
		if got := r.Header.Get("Content-Type"); !strings.Contains(got, "multipart/form-data") {
			t.Fatalf("expected multipart content type, got %q", got)
		}
		if err := r.ParseMultipartForm(8 << 20); err != nil {
			t.Fatalf("failed to parse multipart form: %v", err)
		}
		if got := r.FormValue("searchProfileId"); got != "sales-engineer" {
			t.Fatalf("unexpected searchProfileId: %q", got)
		}
		if got := r.FormValue("keyword"); got != "销售工程师" {
			t.Fatalf("unexpected keyword: %q", got)
		}
		if got := r.FormValue("location"); got != "东莞" {
			t.Fatalf("unexpected location: %q", got)
		}
		if got := r.FormValue("limit"); got != "5" {
			t.Fatalf("unexpected limit: %q", got)
		}
		files := r.MultipartForm.File["files"]
		if len(files) != 1 || files[0].Filename != "51job.rar" {
			t.Fatalf("unexpected upload files: %+v", files)
		}
		file, err := files[0].Open()
		if err != nil {
			t.Fatalf("failed to open uploaded file: %v", err)
		}
		defer file.Close()

		content, err := io.ReadAll(file)
		if err != nil {
			t.Fatalf("failed to read uploaded file: %v", err)
		}
		if string(content) != "rar-bytes" {
			t.Fatalf("unexpected uploaded file content: %q", string(content))
		}

		_ = json.NewEncoder(w).Encode(ResumeManualImportResponse{
			Success: true,
			Source: ResumeManualImportSource{
				Key:   "51job-manual",
				Label: "51job-manual",
			},
			Summary: ResumeManualImportSummary{
				UploadedFiles:   1,
				DiscoveredFiles: 1,
				ParsedResumes:   1,
				Imported:        1,
				Inserted:        1,
			},
			Files: []ResumeManualImportFileResult{
				{
					UploadName: "51job.rar",
					EntryPath:  "51job_张三(123456).docx",
					Extension:  ".docx",
					Status:     "imported",
					ResumeName: "张三",
					ProfileID:  "123456",
				},
			},
		})
	}))
	defer server.Close()

	c := New(server.URL, server.URL, "hr")
	c.HTTP = server.Client()

	response, err := c.ImportManualResumes(context.Background(), ResumeManualImportRequest{
		FilePaths:       []string{uploadPath},
		SearchProfileID: "sales-engineer",
		Keyword:         "销售工程师",
		Location:        "东莞",
		Limit:           5,
	})
	if err != nil {
		t.Fatalf("ImportManualResumes returned error: %v", err)
	}
	if !response.Success || response.Summary.Imported != 1 {
		t.Fatalf("unexpected import response: %+v", response)
	}
	if len(response.Files) != 1 || response.Files[0].ResumeName != "张三" {
		t.Fatalf("unexpected file response: %+v", response.Files)
	}
}

func TestAuthenticatedMultipartImportUsesSessionAndCSRF(t *testing.T) {
	uploadPath := filepath.Join(t.TempDir(), "resume.json")
	if err := os.WriteFile(uploadPath, []byte(`{"resumeId":"resume-one"}`), 0o600); err != nil {
		t.Fatalf("write upload fixture: %v", err)
	}

	var loginCalls atomic.Int32
	var importCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/login" {
			loginCalls.Add(1)
			writeSessionLoginSuccess(w, "multipart-session", "multipart-csrf-cookie", "multipart-json-csrf")
			return
		}
		importCalls.Add(1)
		if cookie, err := r.Cookie("custom_session"); err != nil || cookie.Value != "multipart-session" {
			t.Error("multipart request did not receive API session cookie")
		}
		if r.Header.Get("X-CSRF-Token") != "multipart-json-csrf" {
			t.Error("multipart request did not receive JSON CSRF token")
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Errorf("parse authenticated multipart form: %v", err)
		}
		_ = json.NewEncoder(w).Encode(ResumeManualImportResponse{Success: true})
	}))
	defer server.Close()

	c := newAuthenticatedTestClient(server, "multipart-user", "multipart-password")
	if _, err := c.ImportManualResumes(context.Background(), ResumeManualImportRequest{FilePaths: []string{uploadPath}}); err != nil {
		t.Fatalf("authenticated multipart import failed: %v", err)
	}
	if loginCalls.Load() != 1 || importCalls.Load() != 1 {
		t.Fatalf("expected one login and one multipart import, got login=%d import=%d", loginCalls.Load(), importCalls.Load())
	}
}

func TestMultipart401IsNotReplayed(t *testing.T) {
	uploadPath := filepath.Join(t.TempDir(), "resume.json")
	if err := os.WriteFile(uploadPath, []byte(`{"resumeId":"resume-one"}`), 0o600); err != nil {
		t.Fatalf("write upload fixture: %v", err)
	}

	var loginCalls atomic.Int32
	var importCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/login" {
			loginCalls.Add(1)
			writeSessionLoginSuccess(w, "multipart-401-session", "multipart-401-cookie", "multipart-401-token")
			return
		}
		importCalls.Add(1)
		http.Error(w, "expired", http.StatusUnauthorized)
	}))
	defer server.Close()

	c := newAuthenticatedTestClient(server, "multipart-401-user", "multipart-401-password")
	_, err := c.ImportManualResumes(context.Background(), ResumeManualImportRequest{FilePaths: []string{uploadPath}})
	if err == nil {
		t.Fatal("expected multipart 401 error")
	}
	if !isAuthenticationError(err) {
		t.Fatalf("expected multipart 401 to retain authentication type, got %T", err)
	}
	if loginCalls.Load() != 1 || importCalls.Load() != 1 {
		t.Fatalf("expected no replay, got login=%d import=%d", loginCalls.Load(), importCalls.Load())
	}
}
