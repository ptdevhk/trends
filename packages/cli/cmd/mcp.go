package cmd

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"github.com/ptdevhk/trends/packages/cli/internal/client"
	"github.com/spf13/cobra"
)

type mcpRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type mcpToolCallParams struct {
	Name      string                 `json:"name"`
	Arguments map[string]interface{} `json:"arguments"`
}

func newMCPCmd() *cobra.Command {
	mcpCmd := &cobra.Command{
		Use:   "mcp",
		Short: "MCP server mode",
	}

	mcpCmd.AddCommand(&cobra.Command{
		Use:   "serve",
		Short: "Serve CLI tools over MCP stdio",
		RunE: func(cmd *cobra.Command, args []string) error {
			return serveMCP(context.Background())
		},
	})

	return mcpCmd
}

func serveMCP(ctx context.Context) error {
	reader := bufio.NewReader(os.Stdin)
	writer := bufio.NewWriter(os.Stdout)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		payload, err := readMCPMessage(reader)
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}

		var request mcpRequest
		if err := json.Unmarshal(payload, &request); err != nil {
			if err := writeMCPError(writer, nil, -32700, "parse error"); err != nil {
				return err
			}
			continue
		}

		hasID := len(request.ID) > 0 && string(request.ID) != "null"
		response, responseErr := handleMCPRequest(ctx, request)
		if responseErr != nil {
			if hasID {
				if err := writeMCPError(writer, request.ID, -32000, responseErr.Error()); err != nil {
					return err
				}
			}
			continue
		}
		if !hasID {
			continue
		}
		if err := writeMCPResult(writer, request.ID, response); err != nil {
			return err
		}
	}
}

func handleMCPRequest(ctx context.Context, request mcpRequest) (any, error) {
	switch request.Method {
	case "initialize":
		return map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities": map[string]any{
				"tools": map[string]any{},
			},
			"serverInfo": map[string]any{
				"name":    "trends-cli",
				"version": currentVersion(),
			},
		}, nil
	case "ping":
		return map[string]any{}, nil
	case "tools/list":
		return map[string]any{"tools": mcpTools()}, nil
	case "tools/call":
		var params mcpToolCallParams
		if err := json.Unmarshal(request.Params, &params); err != nil {
			return nil, fmt.Errorf("invalid tools/call params: %w", err)
		}
		text, toolErr := runMCPTool(ctx, params.Name, params.Arguments)
		if toolErr != nil {
			return map[string]any{
				"isError": true,
				"content": []map[string]any{{
					"type": "text",
					"text": toolErr.Error(),
				}},
			}, nil
		}
		return map[string]any{
			"content": []map[string]any{{
				"type": "text",
				"text": text,
			}},
		}, nil
	case "notifications/initialized":
		return nil, nil
	default:
		return nil, fmt.Errorf("method not found: %s", request.Method)
	}
}

func mcpTools() []map[string]any {
	return []map[string]any{
		{
			"name":        "resume_list",
			"description": "List resumes",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"limit": map[string]any{"type": "integer", "minimum": 1},
				},
			},
		},
		{
			"name":        "resume_search",
			"description": "Search resumes by query",
			"inputSchema": map[string]any{
				"type":     "object",
				"required": []string{"query"},
				"properties": map[string]any{
					"query": map[string]any{"type": "string"},
					"limit": map[string]any{"type": "integer", "minimum": 1},
				},
			},
		},
		{
			"name":        "resume_matches",
			"description": "Show cached resume matches",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"sessionId":        map[string]any{"type": "string"},
					"jobDescriptionId": map[string]any{"type": "string"},
				},
			},
		},
		{
			"name":        "resume_match_runs",
			"description": "Show recent resume match runs",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"sessionId":        map[string]any{"type": "string"},
					"jobDescriptionId": map[string]any{"type": "string"},
					"limit":            map[string]any{"type": "integer", "minimum": 1},
				},
			},
		},
		{
			"name":        "resume_skills_version",
			"description": "Show the current resume skills/config version",
			"inputSchema": map[string]any{"type": "object"},
		},
		{
			"name":        "jd_list",
			"description": "List job descriptions",
			"inputSchema": map[string]any{"type": "object"},
		},
		{
			"name":        "worker_status",
			"description": "Get worker status",
			"inputSchema": map[string]any{"type": "object"},
		},
		{
			"name":        "crawl_trigger",
			"description": "Trigger crawl via worker",
			"inputSchema": map[string]any{"type": "object"},
		},
		{
			"name":        "worker_run",
			"description": "Trigger worker run",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"once": map[string]any{"type": "boolean"},
				},
			},
		},
		{
			"name":        "migrate_reindex_search",
			"description": "Run migrations:reindexSearchText",
			"inputSchema": map[string]any{"type": "object"},
		},
		{
			"name":        "migrate_backfill_ingest",
			"description": "Run migrations:backfillIngestData",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"limit": map[string]any{"type": "integer", "minimum": 1},
				},
			},
		},
		{
			"name":        "migrate_backfill_score",
			"description": "Run migrations:backfillPrimaryRuleScore",
			"inputSchema": map[string]any{"type": "object"},
		},
	}
}

func runMCPTool(ctx context.Context, name string, args map[string]interface{}) (string, error) {
	apiClient := newAPIClient()

	switch name {
	case "resume_list":
		limit := intArg(args, "limit", 50)
		result, err := apiClient.ListResumes(ctx, limit, "", "sample")
		if err != nil {
			return "", err
		}
		return prettyJSON(result)
	case "resume_search":
		query := stringArg(args, "query", "")
		if strings.TrimSpace(query) == "" {
			return "", fmt.Errorf("query is required")
		}
		limit := intArg(args, "limit", 50)
		result, err := apiClient.SearchResumes(ctx, query, limit, "sample")
		if err != nil {
			return "", err
		}
		return prettyJSON(result)
	case "resume_matches":
		result, err := apiClient.ListResumeMatches(
			ctx,
			stringArg(args, "sessionId", ""),
			stringArg(args, "jobDescriptionId", ""),
		)
		if err != nil {
			return "", err
		}
		return prettyJSON(result)
	case "resume_match_runs":
		result, err := apiClient.ListResumeMatchRuns(ctx, client.MatchRunsQuery{
			SessionID:        stringArg(args, "sessionId", ""),
			JobDescriptionID: stringArg(args, "jobDescriptionId", ""),
			Limit:            intArg(args, "limit", 20),
		})
		if err != nil {
			return "", err
		}
		return prettyJSON(result)
	case "resume_skills_version":
		result, err := apiClient.GetResumeSkillsVersion(ctx)
		if err != nil {
			return "", err
		}
		return prettyJSON(result)
	case "jd_list":
		result, err := apiClient.ListJobDescriptions(ctx)
		if err != nil {
			return "", err
		}
		return prettyJSON(result)
	case "worker_status":
		result, err := apiClient.WorkerStatus(ctx)
		if err != nil {
			return "", err
		}
		return prettyJSON(result)
	case "crawl_trigger":
		result, err := apiClient.TriggerCrawl(ctx)
		if err != nil {
			return "", err
		}
		return prettyJSON(result)
	case "worker_run":
		once := boolArg(args, "once", true)
		result, err := apiClient.RunWorker(ctx, once)
		if err != nil {
			return "", err
		}
		return prettyJSON(result)
	case "migrate_reindex_search":
		result, err := runConvexCommand(ctx, "migrations:reindexSearchText")
		if err != nil {
			return "", err
		}
		return result, nil
	case "migrate_backfill_ingest":
		limit := intArg(args, "limit", 100)
		result, err := runConvexCommand(ctx, "migrations:backfillIngestData", fmt.Sprintf(`{"limit":%d}`, limit))
		if err != nil {
			return "", err
		}
		return result, nil
	case "migrate_backfill_score":
		result, err := runConvexCommand(ctx, "migrations:backfillPrimaryRuleScore")
		if err != nil {
			return "", err
		}
		return result, nil
	default:
		return "", fmt.Errorf("unknown tool: %s", name)
	}
}

func intArg(args map[string]interface{}, key string, defaultValue int) int {
	if args == nil {
		return defaultValue
	}
	value, ok := args[key]
	if !ok || value == nil {
		return defaultValue
	}
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(typed))
		if err != nil {
			return defaultValue
		}
		return parsed
	default:
		return defaultValue
	}
}

func stringArg(args map[string]interface{}, key string, defaultValue string) string {
	if args == nil {
		return defaultValue
	}
	value, ok := args[key]
	if !ok || value == nil {
		return defaultValue
	}
	text, ok := value.(string)
	if !ok {
		return defaultValue
	}
	return text
}

func boolArg(args map[string]interface{}, key string, defaultValue bool) bool {
	if args == nil {
		return defaultValue
	}
	value, ok := args[key]
	if !ok || value == nil {
		return defaultValue
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		parsed, err := strconv.ParseBool(strings.TrimSpace(typed))
		if err != nil {
			return defaultValue
		}
		return parsed
	default:
		return defaultValue
	}
}

func prettyJSON(value any) (string, error) {
	encoded, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func readMCPMessage(reader *bufio.Reader) ([]byte, error) {
	headers := map[string]string{}

	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return nil, err
		}
		trimmed := strings.TrimRight(line, "\r\n")
		if trimmed == "" {
			break
		}
		parts := strings.SplitN(trimmed, ":", 2)
		if len(parts) != 2 {
			continue
		}
		headers[strings.ToLower(strings.TrimSpace(parts[0]))] = strings.TrimSpace(parts[1])
	}

	contentLengthRaw, ok := headers["content-length"]
	if !ok {
		return nil, fmt.Errorf("missing Content-Length header")
	}
	contentLength, err := strconv.Atoi(contentLengthRaw)
	if err != nil {
		return nil, fmt.Errorf("invalid Content-Length: %w", err)
	}
	if contentLength < 0 {
		return nil, fmt.Errorf("invalid Content-Length value: %d", contentLength)
	}

	payload := make([]byte, contentLength)
	if _, err := io.ReadFull(reader, payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func writeMCPResult(writer *bufio.Writer, id json.RawMessage, result any) error {
	response := map[string]any{
		"jsonrpc": "2.0",
		"id":      json.RawMessage(id),
		"result":  result,
	}
	return writeMCPMessage(writer, response)
}

func writeMCPError(writer *bufio.Writer, id json.RawMessage, code int, message string) error {
	response := map[string]any{
		"jsonrpc": "2.0",
		"id":      nil,
		"error": map[string]any{
			"code":    code,
			"message": message,
		},
	}
	if len(id) > 0 {
		response["id"] = json.RawMessage(id)
	}
	return writeMCPMessage(writer, response)
}

func writeMCPMessage(writer *bufio.Writer, payload any) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	if _, err := writer.WriteString(fmt.Sprintf("Content-Length: %d\r\n\r\n", len(encoded))); err != nil {
		return err
	}
	if _, err := writer.Write(encoded); err != nil {
		return err
	}
	return writer.Flush()
}
