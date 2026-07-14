package cmd

import (
	"bytes"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/ptdevhk/trends/packages/cli/internal/client"
)

const (
	auditDispatchedAt = int64(1_750_000_000_001)
	auditCompletedAt  = int64(1_750_000_000_100)
	auditPrompt       = 42
)

func auditTaskMetadata(taskID string, overrides ...map[string]any) map[string]any {
	task := map[string]any{
		"taskId": taskID, "status": "completed", "dispatchMode": "exact",
		"workspaceSlug": "dev", "dispatchedAt": auditDispatchedAt, "completedAt": auditCompletedAt,
		"expectedJobDescriptionId": "jd-exact", "expectedPromptVersion": auditPrompt, "targetCount": 34,
	}
	for _, override := range overrides {
		for key, value := range override {
			task[key] = value
		}
	}
	return task
}

func auditExportRow(taskID string, index int, targeted bool, state string) map[string]any {
	resumeID := fmt.Sprintf("resume-%05d", index)
	reasons := []string{}
	if state != "ready" {
		reasons = []string{state}
	}
	row := map[string]any{
		"currentResumeId":      resumeID,
		"canonicalIdentityKey": "resumeId:" + resumeID,
		"externalId":           "external-" + resumeID,
		"profileResumeId":      "profile-" + resumeID,
		"profileUrl":           "https://example.com/candidates/" + resumeID,
		"source":               "seek", "sourceKey": "seek", "workspaceSlug": "dev", "name": "Candidate " + resumeID,
		"taskId": taskID, "taskStatus": "completed", "taskWorkspaceSlug": "dev",
		"taskDispatchedAt": auditDispatchedAt, "taskCompletedAt": auditCompletedAt,
		"expectedJobDescriptionId": "jd-exact", "expectedPromptVersion": auditPrompt,
		"expectedAnalysisKey": "source:seek|locale:en|analysis:jd-exact",
		"exactCohortMember":   targeted, "analysisState": state, "analysisReasons": reasons,
		"brandHits": []any{}, "companyHits": []any{}, "ruleScores": map[string]any{"sales": 63},
	}
	if state == "ready" {
		row["currentAnalysisKey"] = "source:seek|locale:en|analysis:jd-exact"
		row["currentJobDescriptionId"] = "jd-exact"
		row["currentPromptVersion"] = auditPrompt
		row["currentLocale"] = "en"
		row["currentAnalyzedAt"] = auditDispatchedAt + 1
		row["finalAiScore"] = 79
		row["currentRecommendation"] = "match"
		row["currentBreakdown"] = map[string]any{"related_exp": 78, "industry_db": 40}
		row["relatedExpAuditFactor"] = 78
		row["relatedExpContribution"] = 39
		row["industryDbContribution"] = 40
		row["currentAISummary"] = "Persisted exact-task score"
		row["currentHighlights"] = []string{"CNC sales"}
		row["currentConcerns"] = []string{"Limited premium-brand coverage"}
	}
	return row
}

func writeAuditExportPage(
	w http.ResponseWriter,
	task map[string]any,
	rows []map[string]any,
	continueCursor string,
	isDone bool,
	scanned int,
) {
	targeted := 0
	ready := 0
	for _, row := range rows {
		if row["exactCohortMember"] == true {
			targeted++
		}
		if row["analysisState"] == "ready" {
			ready++
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"task":    task,
		"counts": map[string]any{
			"scanned": scanned, "exported": len(rows), "targeted": targeted, "ready": ready,
		},
		"page": rows, "continueCursor": continueCursor, "isDone": isDone,
	})
}

func executeResumeExport(t *testing.T, apiURL string, outputMode string, args ...string) (bytes.Buffer, error) {
	t.Helper()
	setResumeCLIConfig(t, apiURL, "dev")
	setCLIOutput(t, outputMode)
	cmd := newResumeExportCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs(args)
	return output, cmd.Execute()
}

func assertNoAuditExportFiles(t *testing.T, finalPath string) {
	t.Helper()
	if _, err := os.Stat(finalPath); !os.IsNotExist(err) {
		t.Fatalf("final export unexpectedly exists: %s (err=%v)", finalPath, err)
	}
	matches, err := filepath.Glob(filepath.Join(
		filepath.Dir(finalPath),
		"."+filepath.Base(finalPath)+".*.tmp",
	))
	if err != nil {
		t.Fatalf("glob temporary exports: %v", err)
	}
	if len(matches) != 0 {
		t.Fatalf("temporary exports were not removed: %v", matches)
	}
}

func TestResumeExportSampleDefaultsAndXLSXRemainUnchanged(t *testing.T) {
	for _, format := range []string{"csv", "xlsx"} {
		t.Run(format, func(t *testing.T) {
			var listCalls atomic.Int32
			var exportCalls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/resumes":
					listCalls.Add(1)
					if got := r.URL.Query().Get("source"); got != "sample" {
						t.Fatalf("sample source changed: %q", got)
					}
					if got := r.URL.Query().Get("limit"); got != "200" {
						t.Fatalf("sample limit changed: %q", got)
					}
					_ = json.NewEncoder(w).Encode(map[string]any{
						"success": true,
						"data":    []map[string]any{{"resumeId": "sample-resume-1", "name": "Alice"}},
						"sample":  map[string]any{"name": "sample-initial", "filename": "sample.json", "updatedAt": "now", "size": 1},
						"summary": map[string]any{"total": 1, "returned": 1, "query": "", "source": "sample"},
					})
				case "/api/resumes/export":
					exportCalls.Add(1)
					var request map[string]any
					if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
						t.Fatalf("decode sample export request: %v", err)
					}
					if request["source"] != "sample" || request["format"] != format || request["sample"] != "sample-initial" {
						t.Fatalf("sample request changed: %+v", request)
					}
					entries, ok := request["entries"].([]any)
					if !ok || len(entries) != 1 {
						t.Fatalf("sample entries changed: %+v", request["entries"])
					}
					w.Header().Set("Content-Disposition", `attachment; filename="resumes.`+format+`"`)
					_, _ = w.Write([]byte("sample-" + format + "-bytes"))
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()

			outPath := filepath.Join(t.TempDir(), "sample."+format)
			args := []string{"--out", outPath}
			if format != "csv" {
				args = append(args, "--format", format)
			}
			output, err := executeResumeExport(t, server.URL, "json", args...)
			if err != nil {
				t.Fatalf("sample export failed: %v", err)
			}
			if listCalls.Load() != 1 || exportCalls.Load() != 1 {
				t.Fatalf("sample calls list=%d export=%d", listCalls.Load(), exportCalls.Load())
			}
			payload := decodeCommandJSON(t, output)
			if payload["count"] != float64(1) || payload["file"] != outPath || payload["bytes"] != float64(len("sample-"+format+"-bytes")) {
				t.Fatalf("sample output changed: %+v", payload)
			}
			if _, exists := payload["sha256"]; exists {
				t.Fatalf("sample output unexpectedly gained audit hash: %+v", payload)
			}
			content, err := os.ReadFile(outPath)
			if err != nil || string(content) != "sample-"+format+"-bytes" {
				t.Fatalf("sample file changed: content=%q err=%v", content, err)
			}
		})
	}
}

func TestResumeExportConvexModeRequiresExactUncappedCSVFlags(t *testing.T) {
	outPath := filepath.Join(t.TempDir(), "audit.csv")
	tests := []struct {
		name string
		args []string
		want string
	}{
		{name: "unknown source", args: []string{"--source", "other"}, want: "invalid source"},
		{name: "missing all", args: []string{"--source", "convex"}, want: "--all"},
		{name: "missing task", args: []string{"--source", "convex", "--all", "--out", outPath}, want: "--analysis-task"},
		{name: "missing out", args: []string{"--source", "convex", "--all", "--analysis-task", "task-1"}, want: "--out"},
		{name: "xlsx", args: []string{"--source", "convex", "--all", "--analysis-task", "task-1", "--out", outPath, "--format", "xlsx"}, want: "csv"},
		{name: "query", args: []string{"--source", "convex", "--all", "--analysis-task", "task-1", "--out", outPath, "--query", "CNC"}, want: "--query"},
		{name: "empty query override", args: []string{"--source", "convex", "--all", "--analysis-task", "task-1", "--out", outPath, "--query", ""}, want: "--query"},
		{name: "limit", args: []string{"--source", "convex", "--all", "--analysis-task", "task-1", "--out", outPath, "--limit", "200"}, want: "--limit"},
		{name: "sample all", args: []string{"--source", "sample", "--all", "--out", outPath}, want: "--all"},
		{name: "sample task", args: []string{"--source", "sample", "--analysis-task", "task-1", "--out", outPath}, want: "--analysis-task"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := executeResumeExport(t, "http://127.0.0.1:1", "json", test.args...)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected error containing %q, got %v", test.want, err)
			}
		})
	}
}

func TestResumeExportConvexModeUsesOneAuthenticatedSessionAcrossEmptyIntermediatePage(t *testing.T) {
	setCommandSessionAuthEnvironment(t)
	var loginCalls atomic.Int32
	var pageCalls atomic.Int32
	taskID := "task/with space"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if handleCommandSessionLogin(t, w, r, &loginCalls) {
			return
		}
		pageCalls.Add(1)
		assertCommandSessionRequest(t, r, false)
		if got := r.URL.EscapedPath(); got != "/api/resumes/analysis-tasks/task%2Fwith%20space/audit-export" {
			t.Fatalf("unexpected path: %s", got)
		}
		if got := r.URL.Query().Get("limit"); got != "200" {
			t.Fatalf("unexpected page limit: %q", got)
		}
		switch r.URL.Query().Get("cursor") {
		case "":
			writeAuditExportPage(w, auditTaskMetadata(taskID), []map[string]any{
				auditExportRow(taskID, 1, true, "ready"),
			}, "cursor/with +", false, 1)
		case "cursor/with +":
			writeAuditExportPage(w, auditTaskMetadata(taskID), []map[string]any{}, "cursor-3", false, 1)
		case "cursor-3":
			writeAuditExportPage(w, auditTaskMetadata(taskID), []map[string]any{
				auditExportRow(taskID, 2, false, "not_targeted"),
			}, "", true, 1)
		default:
			t.Fatalf("unexpected cursor: %q", r.URL.Query().Get("cursor"))
		}
	}))
	defer server.Close()

	outPath := filepath.Join(t.TempDir(), "audit.csv")
	_, err := executeResumeExport(
		t, server.URL, "json",
		"--source", "convex", "--all", "--analysis-task", taskID, "--format", "csv", "--out", outPath,
	)
	if err != nil {
		t.Fatalf("convex export failed: %v", err)
	}
	if loginCalls.Load() != 1 || pageCalls.Load() != 3 {
		t.Fatalf("session/page calls login=%d pages=%d", loginCalls.Load(), pageCalls.Load())
	}
	records := readCSVRecords(t, outPath)
	if len(records) != 3 {
		t.Fatalf("expected header + 2 rows, got %d", len(records))
	}
}

func TestResumeExportConvexModeWrites8958UniqueRows(t *testing.T) {
	const total = 8_958
	taskID := "task-8958"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/resumes/analysis-tasks/task-8958/audit-export" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("limit"); got != "200" {
			t.Fatalf("unexpected limit: %q", got)
		}
		start := 0
		if cursor := r.URL.Query().Get("cursor"); cursor != "" {
			parsed, err := strconv.Atoi(cursor)
			if err != nil {
				t.Fatalf("invalid cursor: %q", cursor)
			}
			start = parsed
		}
		end := min(start+200, total)
		rows := make([]map[string]any, 0, end-start)
		for index := start; index < end; index++ {
			targeted := index < 34
			state := "not_targeted"
			if targeted {
				state = "ready"
			}
			rows = append(rows, auditExportRow(taskID, index+1, targeted, state))
		}
		isDone := end == total
		continueCursor := strconv.Itoa(end)
		if isDone {
			continueCursor = ""
		}
		writeAuditExportPage(w, auditTaskMetadata(taskID), rows, continueCursor, isDone, len(rows))
	}))
	defer server.Close()

	outPath := filepath.Join(t.TempDir(), "audit-8958.csv")
	output, err := executeResumeExport(
		t, server.URL, "json",
		"--source", "convex", "--all", "--analysis-task", taskID, "--out", outPath,
	)
	if err != nil {
		t.Fatalf("8,958-row export failed: %v", err)
	}
	payload := decodeCommandJSON(t, output)
	if payload["count"] != float64(total) {
		t.Fatalf("unexpected reported count: %+v", payload)
	}
	records := readCSVRecords(t, outPath)
	if len(records) != total+1 {
		t.Fatalf("expected %d CSV records, got %d", total+1, len(records))
	}
	idColumn := -1
	for index, header := range records[0] {
		if header == "Current Convex Resume ID" {
			idColumn = index
			break
		}
	}
	if idColumn < 0 {
		t.Fatalf("missing Current Convex Resume ID header: %v", records[0])
	}
	unique := make(map[string]struct{}, total)
	for _, record := range records[1:] {
		unique[record[idColumn]] = struct{}{}
	}
	if len(unique) != total {
		t.Fatalf("expected %d unique resume IDs, got %d", total, len(unique))
	}
}

func readCSVRecords(t *testing.T, path string) [][]string {
	t.Helper()
	file, err := os.Open(path)
	if err != nil {
		t.Fatalf("open CSV: %v", err)
	}
	defer file.Close()
	records, err := csv.NewReader(file).ReadAll()
	if err != nil {
		t.Fatalf("read CSV: %v", err)
	}
	return records
}

func TestExactTaskAuditCSVNeutralizesSpreadsheetFormulaCells(t *testing.T) {
	payload, err := encodeExactTaskAuditCSV([]client.ExactTaskAuditRow{{
		Name:                  "=scalar-formula",
		Age:                   json.RawMessage(`"+json-formula"`),
		Location:              "-location-formula",
		CurrentAISummary:      "@model-formula",
		EvidenceText:          "\tevidence-formula",
		CurrentRecommendation: "\rrecommendation-formula",
	}})
	if err != nil {
		t.Fatalf("encode audit CSV: %v", err)
	}

	records, err := csv.NewReader(bytes.NewReader(payload)).ReadAll()
	if err != nil {
		t.Fatalf("read audit CSV: %v", err)
	}
	if len(records) != 2 {
		t.Fatalf("expected header plus one row, got %d records", len(records))
	}
	cell := func(header string) string {
		t.Helper()
		for index, value := range records[0] {
			if value == header {
				return records[1][index]
			}
		}
		t.Fatalf("missing %q column", header)
		return ""
	}

	for header, want := range map[string]string{
		"Name":                   "'=scalar-formula",
		"Age":                    "'+json-formula",
		"Location":               "'-location-formula",
		"Current AI Summary":     "'@model-formula",
		"Evidence Text":          "'\tevidence-formula",
		"Current Recommendation": "'\rrecommendation-formula",
	} {
		if got := cell(header); got != want {
			t.Errorf("%s formula cell = %q, want %q", header, got, want)
		}
	}
	if records[0][0] != exactTaskAuditCSVHeaders[0] {
		t.Fatalf("static audit CSV header changed: %q", records[0][0])
	}
}

func TestAuditPrivateAtomicFileCreatesMissingDirectoriesOwnerOnly(t *testing.T) {
	root := t.TempDir()
	directory := filepath.Join(root, "nested", "audit")
	path := filepath.Join(directory, "export.csv")
	if err := installPrivateAtomicFile(path, []byte("private audit payload")); err != nil {
		t.Fatalf("install private audit file: %v", err)
	}

	for _, createdDirectory := range []string{
		filepath.Join(root, "nested"),
		directory,
	} {
		info, err := os.Stat(createdDirectory)
		if err != nil {
			t.Fatalf("stat created audit directory %s: %v", createdDirectory, err)
		}
		if got := info.Mode().Perm(); got != 0o700 {
			t.Errorf("created audit directory %s mode = %04o, want 0700", createdDirectory, got)
		}
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat private audit file: %v", err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("private audit file mode = %04o, want 0600", got)
	}
}

func TestAuditPrivateAtomicFilePreservesExistingDirectoryMode(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "existing-audit-output")
	if err := os.Mkdir(directory, 0o755); err != nil {
		t.Fatalf("create existing audit directory: %v", err)
	}
	if err := os.Chmod(directory, 0o755); err != nil {
		t.Fatalf("set existing audit directory mode: %v", err)
	}

	if err := installPrivateAtomicFile(filepath.Join(directory, "export.csv"), []byte("private audit payload")); err != nil {
		t.Fatalf("install private audit file: %v", err)
	}
	info, err := os.Stat(directory)
	if err != nil {
		t.Fatalf("stat existing audit directory: %v", err)
	}
	if got := info.Mode().Perm(); got != 0o755 {
		t.Fatalf("existing audit directory mode = %04o, want unchanged 0755", got)
	}
}

func TestResumeExportConvexModeRejectsInvalidStreamsWithoutPartialFiles(t *testing.T) {
	tests := []struct {
		scenario        string
		wantErr         string
		analysisState   string
		analysisReasons []string
	}{
		{scenario: "empty completed export", wantErr: "no active workspace resumes"},
		{scenario: "stale score evidence", wantErr: "non-ready row includes score evidence"},
		{scenario: "empty non-ready reason metadata", wantErr: "analysis reason/state mismatch"},
		{scenario: "contradictory non-ready reason metadata", wantErr: "analysis reason/state mismatch"},
		{
			scenario:        "terminal reason contamination",
			wantErr:         "analysis reason/state mismatch",
			analysisState:   "cold_row_missing",
			analysisReasons: []string{"cold_row_missing", "prompt_version_mismatch"},
		},
		{
			scenario:        "duplicate mismatch reason",
			wantErr:         "analysis reason/state mismatch",
			analysisState:   "job_description_mismatch",
			analysisReasons: []string{"job_description_mismatch", "job_description_mismatch"},
		},
		{
			scenario:        "mutually exclusive timestamp reasons",
			wantErr:         "analysis reason/state mismatch",
			analysisState:   "job_description_mismatch",
			analysisReasons: []string{"job_description_mismatch", "timestamp_missing", "not_newer_than_dispatch"},
		},
		{
			scenario:        "invalid mismatch reason ordering",
			wantErr:         "analysis reason/state mismatch",
			analysisState:   "prompt_version_mismatch",
			analysisReasons: []string{"prompt_version_mismatch", "job_description_mismatch"},
		},
		{scenario: "repeated cursor", wantErr: "repeated cursor"},
		{scenario: "duplicate resume", wantErr: "duplicate resume"},
		{scenario: "changed task", wantErr: "task metadata changed"},
		{scenario: "cumulative targeted count", wantErr: "cumulative cohort count"},
		{scenario: "malformed page", wantErr: "malformed"},
		{scenario: "http error", wantErr: "500"},
	}
	for _, test := range tests {
		t.Run(test.scenario, func(t *testing.T) {
			scenario := test.scenario
			taskID := "task-failure"
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				cursor := r.URL.Query().Get("cursor")
				if scenario == "malformed page" {
					_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "task": auditTaskMetadata(taskID), "page": "invalid"})
					return
				}
				if scenario == "empty completed export" {
					writeAuditExportPage(w, auditTaskMetadata(taskID), []map[string]any{}, "", true, 0)
					return
				}
				if scenario == "stale score evidence" {
					row := auditExportRow(taskID, 1, true, "cold_row_missing")
					row["finalAiScore"] = 79
					writeAuditExportPage(w, auditTaskMetadata(taskID), []map[string]any{row}, "", true, 1)
					return
				}
				if scenario == "empty non-ready reason metadata" {
					row := auditExportRow(taskID, 1, true, "job_description_mismatch")
					row["analysisReasons"] = []string{}
					writeAuditExportPage(w, auditTaskMetadata(taskID), []map[string]any{row}, "", true, 1)
					return
				}
				if scenario == "contradictory non-ready reason metadata" {
					row := auditExportRow(taskID, 1, true, "job_description_mismatch")
					row["analysisReasons"] = []string{"prompt_version_mismatch"}
					writeAuditExportPage(w, auditTaskMetadata(taskID), []map[string]any{row}, "", true, 1)
					return
				}
				if test.analysisState != "" {
					row := auditExportRow(taskID, 1, true, test.analysisState)
					row["analysisReasons"] = test.analysisReasons
					writeAuditExportPage(w, auditTaskMetadata(taskID), []map[string]any{row}, "", true, 1)
					return
				}
				if scenario == "cumulative targeted count" {
					task := auditTaskMetadata(taskID, map[string]any{"targetCount": 1})
					if cursor == "" {
						writeAuditExportPage(w, task, []map[string]any{
							auditExportRow(taskID, 1, true, "ready"),
						}, "cursor-2", false, 1)
						return
					}
					writeAuditExportPage(w, task, []map[string]any{
						auditExportRow(taskID, 2, true, "ready"),
					}, "", true, 1)
					return
				}
				if cursor == "" {
					writeAuditExportPage(w, auditTaskMetadata(taskID), []map[string]any{
						auditExportRow(taskID, 1, true, "ready"),
					}, "cursor-2", false, 1)
					return
				}
				if scenario == "http error" {
					http.Error(w, "mid-stream failure", http.StatusInternalServerError)
					return
				}
				if scenario == "repeated cursor" {
					writeAuditExportPage(w, auditTaskMetadata(taskID), []map[string]any{}, "cursor-2", false, 0)
					return
				}
				if scenario == "duplicate resume" {
					writeAuditExportPage(w, auditTaskMetadata(taskID), []map[string]any{
						auditExportRow(taskID, 1, true, "ready"),
					}, "", true, 1)
					return
				}
				writeAuditExportPage(
					w,
					auditTaskMetadata(taskID, map[string]any{"expectedPromptVersion": 43}),
					[]map[string]any{auditExportRow(taskID, 2, false, "not_targeted")},
					"",
					true,
					1,
				)
			}))
			defer server.Close()

			finalPath := filepath.Join(t.TempDir(), "failed.csv")
			_, err := executeResumeExport(
				t, server.URL, "json",
				"--source", "convex", "--all", "--analysis-task", taskID, "--out", finalPath,
			)
			if err == nil {
				if _, statErr := os.Stat(finalPath); statErr != nil {
					t.Fatalf("expected %s malformed stream to create a final CSV after acceptance: %v", scenario, statErr)
				}
				t.Fatalf("expected %s failure containing %q; malformed stream was accepted and created a final CSV", scenario, test.wantErr)
			}
			if !strings.Contains(strings.ToLower(err.Error()), test.wantErr) {
				t.Fatalf("expected %s failure containing %q, got %v", scenario, test.wantErr, err)
			}
			assertNoAuditExportFiles(t, finalPath)
		})
	}
}

func TestResumeExportConvexModePreservesOrderedMultiReasonMismatch(t *testing.T) {
	taskID := "task-multi-reason"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		row := auditExportRow(taskID, 1, true, "job_description_mismatch")
		row["analysisReasons"] = []string{
			"job_description_mismatch",
			"prompt_version_mismatch",
			"not_newer_than_dispatch",
		}
		writeAuditExportPage(w, auditTaskMetadata(taskID), []map[string]any{row}, "", true, 1)
	}))
	defer server.Close()

	outPath := filepath.Join(t.TempDir(), "multi-reason.csv")
	_, err := executeResumeExport(
		t, server.URL, "json",
		"--source", "convex", "--all", "--analysis-task", taskID, "--out", outPath,
	)
	if err != nil {
		t.Fatalf("multi-reason export failed: %v", err)
	}
	if len(readCSVRecords(t, outPath)) != 2 {
		t.Fatal("expected header plus one multi-reason row")
	}
}

func TestResumeExportConvexModeAtomicallyReplacesPrivateFileAndReportsSHA256(t *testing.T) {
	taskID := "task-success"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeAuditExportPage(w, auditTaskMetadata(taskID), []map[string]any{
			auditExportRow(taskID, 1, true, "ready"),
		}, "", true, 1)
	}))
	defer server.Close()

	dir := t.TempDir()
	finalPath := filepath.Join(dir, "audit.csv")
	if err := os.WriteFile(finalPath, []byte("old-public-file"), 0o644); err != nil {
		t.Fatalf("seed old export: %v", err)
	}
	if err := os.Chmod(finalPath, 0o644); err != nil {
		t.Fatalf("chmod old export: %v", err)
	}
	output, err := executeResumeExport(
		t, server.URL, "json",
		"--source", "convex", "--all", "--analysis-task", taskID, "--out", finalPath,
	)
	if err != nil {
		t.Fatalf("convex export failed: %v", err)
	}

	absPath, err := filepath.Abs(finalPath)
	if err != nil {
		t.Fatalf("resolve output path: %v", err)
	}
	content, err := os.ReadFile(absPath)
	if err != nil {
		t.Fatalf("read final export: %v", err)
	}
	info, err := os.Stat(absPath)
	if err != nil {
		t.Fatalf("stat final export: %v", err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("expected private 0600 mode, got %04o", got)
	}
	hash := sha256.Sum256(content)
	wantHash := hex.EncodeToString(hash[:])
	payload := decodeCommandJSON(t, output)
	if payload["count"] != float64(1) ||
		payload["file"] != absPath ||
		payload["bytes"] != float64(len(content)) ||
		payload["sha256"] != wantHash ||
		payload["mode"] != "0600" ||
		payload["taskId"] != taskID ||
		payload["cohortMembers"] != float64(1) ||
		payload["ready"] != float64(1) {
		t.Fatalf("unexpected audit report: %+v", payload)
	}
	if strings.ToLower(wantHash) != wantHash || len(wantHash) != 64 {
		t.Fatalf("hash is not lowercase SHA-256: %q", wantHash)
	}
	if len(readCSVRecords(t, absPath)) != 2 {
		t.Fatal("successful output is not a one-row CSV")
	}
	matches, err := filepath.Glob(filepath.Join(dir, ".audit.csv.*.tmp"))
	if err != nil || len(matches) != 0 {
		t.Fatalf("unexpected temporary files: %v err=%v", matches, err)
	}
}

func TestResumeExportConvexModeReportsHashInAgentAndTableOutput(t *testing.T) {
	for _, outputMode := range []string{"agent", "table"} {
		t.Run(outputMode, func(t *testing.T) {
			taskID := "task-output-" + outputMode
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				writeAuditExportPage(w, auditTaskMetadata(taskID), []map[string]any{
					auditExportRow(taskID, 1, true, "ready"),
				}, "", true, 1)
			}))
			defer server.Close()
			outPath := filepath.Join(t.TempDir(), "audit.csv")
			output, err := executeResumeExport(
				t, server.URL, outputMode,
				"--source", "convex", "--all", "--analysis-task", taskID, "--out", outPath,
			)
			if err != nil {
				t.Fatalf("convex export failed: %v", err)
			}
			text := output.String()
			for _, expected := range []string{"sha256", "count", "bytes", "file", "mode", "0600"} {
				if !strings.Contains(strings.ToLower(text), strings.ToLower(expected)) {
					t.Fatalf("%s output missing %s: %s", outputMode, expected, text)
				}
			}
		})
	}
}

func TestResumeExportConvexModeRedactsAuthMaterialFromMidstreamErrorsAndOutput(t *testing.T) {
	setCommandSessionAuthEnvironment(t)
	var loginCalls atomic.Int32
	taskID := "task-auth-error"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if handleCommandSessionLogin(t, w, r, &loginCalls) {
			return
		}
		assertCommandSessionRequest(t, r, false)
		if r.URL.Query().Get("cursor") == "" {
			writeAuditExportPage(w, auditTaskMetadata(taskID), []map[string]any{
				auditExportRow(taskID, 1, true, "ready"),
			}, "cursor-2", false, 1)
			return
		}
		http.Error(
			w,
			strings.Join([]string{
				commandAuthUsername,
				commandAuthPassword,
				commandSessionCookie,
				commandCSRFToken,
				"Cookie: command_session=" + commandSessionCookie,
			}, " | "),
			http.StatusInternalServerError,
		)
	}))
	defer server.Close()

	finalPath := filepath.Join(t.TempDir(), "auth-error.csv")
	output, err := executeResumeExport(
		t, server.URL, "agent",
		"--source", "convex", "--all", "--analysis-task", taskID, "--out", finalPath,
	)
	if err == nil {
		t.Fatal("expected authenticated mid-stream error")
	}
	combined := err.Error() + "\n" + output.String()
	for _, secret := range []string{
		commandAuthUsername,
		commandAuthPassword,
		commandSessionCookie,
		commandCSRFToken,
	} {
		if strings.Contains(combined, secret) {
			t.Fatalf("auth material leaked: %q in %s", secret, combined)
		}
	}
	if loginCalls.Load() != 1 {
		t.Fatalf("expected one login, got %d", loginCalls.Load())
	}
	assertNoAuditExportFiles(t, finalPath)
}
