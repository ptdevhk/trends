package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestListResumesBuildsQueryParams(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/resumes" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("limit"); got != "25" {
			t.Fatalf("expected limit=25, got %q", got)
		}
		if got := r.URL.Query().Get("q"); got != "cnc 东莞" {
			t.Fatalf("expected q query parameter, got %q", got)
		}
		if got := r.URL.Query().Get("source"); got != "convex" {
			t.Fatalf("expected source=convex, got %q", got)
		}

		_ = json.NewEncoder(w).Encode(ResumesResponse{
			Success: true,
			Data: []ResumeItem{
				{ResumeID: "r1", Name: "Alice"},
			},
			Summary: ResumesSummary{Total: 1, Returned: 1, Query: "cnc 东莞"},
		})
	}))
	defer server.Close()

	c := New(server.URL, server.URL, "dev")
	c.HTTP = server.Client()

	response, err := c.ListResumes(context.Background(), 25, "cnc 东莞", "convex")
	if err != nil {
		t.Fatalf("ListResumes returned error: %v", err)
	}
	if len(response.Data) != 1 || response.Data[0].ResumeID != "r1" {
		t.Fatalf("unexpected response: %+v", response)
	}
}

func TestListResumesFailsWhenSuccessFalse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(ResumesResponse{Success: false})
	}))
	defer server.Close()

	c := New(server.URL, server.URL, "dev")
	c.HTTP = server.Client()

	_, err := c.ListResumes(context.Background(), 0, "", "sample")
	if err == nil {
		t.Fatal("expected error for unsuccessful response")
	}
	if !strings.Contains(err.Error(), "not successful") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestExportResumesUsesBinaryEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/resumes/export" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}

		var payload ResumeExportRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("failed to decode request body: %v", err)
		}
		if payload.Format != "csv" {
			t.Fatalf("expected default format csv, got %q", payload.Format)
		}
		if payload.Source != "sample" {
			t.Fatalf("expected source sample, got %q", payload.Source)
		}
		if len(payload.Entries) != 1 || payload.Entries[0].ResumeID != "r1" {
			t.Fatalf("unexpected export entries: %+v", payload.Entries)
		}

		w.Header().Set("Content-Disposition", `attachment; filename="out.csv"`)
		_, _ = w.Write([]byte("x,y\n"))
	}))
	defer server.Close()

	c := New(server.URL, server.URL, "dev")
	c.HTTP = server.Client()

	content, disposition, err := c.ExportResumes(context.Background(), ResumeExportRequest{
		Source: "sample",
		Entries: []ResumeExportEntry{
			{ResumeID: "r1"},
		},
	})
	if err != nil {
		t.Fatalf("ExportResumes returned error: %v", err)
	}
	if string(content) != "x,y\n" {
		t.Fatalf("unexpected content: %q", string(content))
	}
	if !strings.Contains(disposition, "out.csv") {
		t.Fatalf("unexpected disposition: %q", disposition)
	}
}

func TestMatchResumesBuildsRequestBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/resumes/match" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}

		var payload ResumeMatchRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("failed to decode request body: %v", err)
		}
		if payload.Source != "convex" {
			t.Fatalf("expected source convex, got %q", payload.Source)
		}
		if payload.Persist == nil || *payload.Persist != false {
			t.Fatalf("expected persist=false, got %+v", payload.Persist)
		}
		if payload.Mode != "rules_only" {
			t.Fatalf("expected rules_only mode, got %q", payload.Mode)
		}
		if len(payload.Keywords) != 2 || payload.Keywords[0] != "CNC" {
			t.Fatalf("unexpected keywords: %+v", payload.Keywords)
		}

		_ = json.NewEncoder(w).Encode(ResumeMatchResponse{
			Success: true,
			Mode:    "rules_only",
			Results: []ResumeMatchResult{{ResumeID: "resume-1", Score: 88, Recommendation: "match"}},
			Stats:   MatchStats{Processed: 1, Matched: 1, AvgScore: 88},
		})
	}))
	defer server.Close()

	c := New(server.URL, server.URL, "dev")
	c.HTTP = server.Client()
	persist := false

	response, err := c.MatchResumes(context.Background(), ResumeMatchRequest{
		Source:   "convex",
		Persist:  &persist,
		Keywords: []string{"CNC", "销售"},
		Location: "东莞",
		Mode:     "rules_only",
	})
	if err != nil {
		t.Fatalf("MatchResumes returned error: %v", err)
	}
	if len(response.Results) != 1 || response.Results[0].ResumeID != "resume-1" {
		t.Fatalf("unexpected match response: %+v", response)
	}
}

func TestListAndCreateJobDescriptions(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/job-descriptions":
			_ = json.NewEncoder(w).Encode(JobDescriptionsResponse{
				Success: true,
				Items: []JobDescriptionFile{
					{Name: "lathe-sales", Filename: "lathe-sales.md"},
				},
			})
		case r.Method == http.MethodPost && r.URL.Path == "/api/job-descriptions":
			var payload CreateJobDescriptionRequest
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode error: %v", err)
			}
			if payload.Name == "" || payload.Content == "" {
				t.Fatalf("unexpected payload: %+v", payload)
			}
			_ = json.NewEncoder(w).Encode(CreateJobDescriptionResponse{
				Success: true,
				Item: JobDescriptionFile{
					Name:     payload.Name,
					Filename: payload.Name + ".md",
				},
				Content: payload.Content,
			})
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	c := New(server.URL, server.URL, "dev")
	c.HTTP = server.Client()

	list, err := c.ListJobDescriptions(context.Background())
	if err != nil {
		t.Fatalf("ListJobDescriptions returned error: %v", err)
	}
	if len(list.Items) != 1 || list.Items[0].Name != "lathe-sales" {
		t.Fatalf("unexpected list response: %+v", list)
	}

	create, err := c.CreateJobDescription(context.Background(), CreateJobDescriptionRequest{
		Name:    "new-jd",
		Content: "# JD",
	})
	if err != nil {
		t.Fatalf("CreateJobDescription returned error: %v", err)
	}
	if create.Item.Filename != "new-jd.md" {
		t.Fatalf("unexpected create response: %+v", create)
	}
}
