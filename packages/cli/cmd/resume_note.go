package cmd

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/ptdevhk/trends/packages/cli/internal/client"
	"github.com/spf13/cobra"
)

type resumeNoteDelimiter string

const (
	resumeNoteDelimiterAuto  resumeNoteDelimiter = "auto"
	resumeNoteDelimiterTab   resumeNoteDelimiter = "tab"
	resumeNoteDelimiterComma resumeNoteDelimiter = "comma"
)

type resumeNoteRow struct {
	ResumeID string `json:"resumeId"`
	Name     string `json:"name,omitempty"`
	Comments string `json:"comments"`
	Row      int    `json:"row"`
}

type resumeNotePreviewResult struct {
	ResumeID string `json:"resumeId"`
	Name     string `json:"name,omitempty"`
	Comments string `json:"comments"`
	Status   string `json:"status"`
	Row      int    `json:"row"`
}

type resumeNoteDryRunOutput struct {
	Success bool                      `json:"success"`
	DryRun  bool                      `json:"dryRun"`
	Total   int                       `json:"total"`
	Results []resumeNotePreviewResult `json:"results"`
}

type resumeNoteCommandOutput struct {
	Success       bool                               `json:"success"`
	Total         int                                `json:"total"`
	Imported      int                                `json:"imported"`
	Skipped       int                                `json:"skipped"`
	NotFound      []string                           `json:"notFound"`
	NotFoundCount int                                `json:"notFoundCount"`
	Results       []client.ResumeFeedbackBatchResult `json:"results"`
}

func newResumeNoteCmd() *cobra.Command {
	var fromFile string
	var delimiterFlag string
	var dryRun bool

	cmd := &cobra.Command{
		Use:   "note",
		Short: "Import HR feedback comments as resume notes",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			delimiter, err := parseResumeNoteDelimiter(delimiterFlag)
			if err != nil {
				return err
			}

			reader, closeReader, err := openResumeNoteInput(fromFile, cmd.InOrStdin())
			if err != nil {
				return err
			}
			defer closeReader()

			rows, err := parseResumeNoteRows(reader, delimiter)
			if err != nil {
				return err
			}
			if len(rows) == 0 {
				return fmt.Errorf("no feedback rows found")
			}

			if dryRun {
				results := make([]resumeNotePreviewResult, 0, len(rows))
				for _, row := range rows {
					results = append(results, resumeNotePreviewResult{
						ResumeID: row.ResumeID,
						Name:     row.Name,
						Comments: row.Comments,
						Status:   "ready",
						Row:      row.Row,
					})
				}
				return writeResumeNoteOutput(cmd, rows, resumeNoteDryRunOutput{
					Success: true,
					DryRun:  true,
					Total:   len(rows),
					Results: results,
				})
			}

			items := make([]client.ResumeFeedbackBatchItem, 0, len(rows))
			for _, row := range rows {
				items = append(items, client.ResumeFeedbackBatchItem{
					ResumeID: row.ResumeID,
					Name:     row.Name,
					Comments: row.Comments,
				})
			}
			response, err := newAPIClient().ImportResumeFeedbackBatch(context.Background(), items)
			if err != nil {
				return err
			}

			return writeResumeNoteOutput(cmd, rows, resumeNoteCommandOutput{
				Success:       response.Success,
				Total:         response.Total,
				Imported:      response.Imported,
				Skipped:       response.Skipped,
				NotFound:      response.NotFound,
				NotFoundCount: len(response.NotFound),
				Results:       response.Results,
			})
		},
	}

	cmd.Flags().StringVar(&fromFile, "from-file", "", "Read feedback rows from a CSV/TSV file instead of stdin")
	cmd.Flags().StringVar(&delimiterFlag, "delimiter", string(resumeNoteDelimiterAuto), "Input delimiter: auto|tab|comma")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "Parse and preview rows without posting to the API")
	return cmd
}

func parseResumeNoteDelimiter(value string) (resumeNoteDelimiter, error) {
	switch resumeNoteDelimiter(strings.ToLower(strings.TrimSpace(value))) {
	case "", resumeNoteDelimiterAuto:
		return resumeNoteDelimiterAuto, nil
	case resumeNoteDelimiterTab:
		return resumeNoteDelimiterTab, nil
	case resumeNoteDelimiterComma:
		return resumeNoteDelimiterComma, nil
	default:
		return "", fmt.Errorf("invalid delimiter %q (expected auto|tab|comma)", value)
	}
}

func openResumeNoteInput(fromFile string, stdin io.Reader) (io.Reader, func(), error) {
	if strings.TrimSpace(fromFile) == "" {
		return stdin, func() {}, nil
	}
	file, err := os.Open(fromFile)
	if err != nil {
		return nil, func() {}, fmt.Errorf("open feedback file: %w", err)
	}
	return file, func() {
		_ = file.Close()
	}, nil
}

func parseResumeNoteRows(reader io.Reader, delimiter resumeNoteDelimiter) ([]resumeNoteRow, error) {
	raw, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("read feedback rows: %w", err)
	}
	selectedDelimiter := delimiter
	if selectedDelimiter == resumeNoteDelimiterAuto {
		selectedDelimiter = detectResumeNoteDelimiter(string(raw))
	}

	csvReader := csv.NewReader(strings.NewReader(string(raw)))
	csvReader.FieldsPerRecord = -1
	csvReader.TrimLeadingSpace = true
	if selectedDelimiter == resumeNoteDelimiterTab {
		csvReader.Comma = '\t'
	}

	var rows []resumeNoteRow
	seenData := false
	for {
		record, err := csvReader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("parse row %d: %w", len(rows)+1, err)
		}
		if isEmptyResumeNoteRecord(record) {
			continue
		}
		if !seenData && isResumeNoteHeader(record) {
			seenData = true
			continue
		}
		seenData = true
		if len(record) < 3 {
			return nil, fmt.Errorf("row %d has %d columns; expected id, name, comments", len(rows)+1, len(record))
		}

		row := resumeNoteRow{
			ResumeID: strings.TrimSpace(record[0]),
			Name:     strings.TrimSpace(record[1]),
			Comments: strings.TrimSpace(joinResumeNoteComments(record[2:], selectedDelimiter)),
			Row:      len(rows) + 1,
		}
		if row.ResumeID == "" {
			return nil, fmt.Errorf("row %d is missing resume id", row.Row)
		}
		rows = append(rows, row)
	}

	return rows, nil
}

func detectResumeNoteDelimiter(raw string) resumeNoteDelimiter {
	for _, line := range strings.Split(raw, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if strings.Contains(line, "\t") {
			return resumeNoteDelimiterTab
		}
		return resumeNoteDelimiterComma
	}
	return resumeNoteDelimiterComma
}

func isEmptyResumeNoteRecord(record []string) bool {
	for _, field := range record {
		if strings.TrimSpace(field) != "" {
			return false
		}
	}
	return true
}

func normalizeResumeNoteHeader(value string) string {
	return strings.NewReplacer("_", "", "-", "", " ", "").Replace(strings.ToLower(strings.TrimSpace(value)))
}

func isResumeNoteHeader(record []string) bool {
	if len(record) == 0 {
		return false
	}
	switch normalizeResumeNoteHeader(record[0]) {
	case "id", "resumeid", "resume":
		return true
	default:
		return false
	}
}

func joinResumeNoteComments(fields []string, delimiter resumeNoteDelimiter) string {
	separator := ","
	if delimiter == resumeNoteDelimiterTab {
		separator = "\t"
	}
	return strings.Join(fields, separator)
}

func writeResumeNoteOutput(cmd *cobra.Command, rows []resumeNoteRow, raw any) error {
	headers := []string{"id", "name", "comment", "result"}
	statuses := make([]string, 0, len(rows))

	switch value := raw.(type) {
	case resumeNoteDryRunOutput:
		for _, result := range value.Results {
			statuses = append(statuses, result.Status)
		}
	case resumeNoteCommandOutput:
		for _, result := range value.Results {
			statuses = append(statuses, result.Status)
		}
	}

	tableRows := make([][]string, 0, len(rows))
	for index, row := range rows {
		status := ""
		if index < len(statuses) {
			status = statuses[index]
		}
		if status == "" {
			status = "pending"
		}
		tableRows = append(tableRows, []string{row.ResumeID, row.Name, row.Comments, status})
	}
	return writeOutput(cmd, headers, tableRows, raw)
}
