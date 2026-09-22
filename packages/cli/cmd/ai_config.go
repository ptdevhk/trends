package cmd

import (
	"context"
	"fmt"
	"strings"

	"github.com/ptdevhk/trends/packages/cli/internal/client"
	"github.com/spf13/cobra"
)

var getAiRouting = func(ctx context.Context, apiClient *client.Client) (*client.AiRoutingSettings, error) {
	return apiClient.GetAiRouting(ctx)
}

var setAiRouting = func(ctx context.Context, apiClient *client.Client, request client.AiRoutingUpdateRequest) (*client.AiRoutingSettings, error) {
	return apiClient.SetAiRouting(ctx, request)
}

var testAiRouting = func(ctx context.Context, apiClient *client.Client) (*client.AiRoutingTestRaw, error) {
	return apiClient.TestAiRouting(ctx)
}

func newAiConfigCmd() *cobra.Command {
	aiConfigCmd := &cobra.Command{
		Use:   "ai-config",
		Short: "Inspect and update AI routing (model + base URL) hot-config",
	}

	aiConfigCmd.AddCommand(
		newAiConfigGetCmd(),
		newAiConfigSetCmd(),
		newAiConfigTestCmd(),
	)

	return aiConfigCmd
}

func newAiConfigGetCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "get",
		Short: "Show effective + stored AI routing settings",
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := getAiRouting(context.Background(), newAPIClient())
			if err != nil {
				return err
			}

			keyState := "missing"
			if response.ApiKey.Present {
				keyState = "present"
			}
			headers := []string{"field", "value", "source"}
			rows := [][]string{
				{"api_base", response.Effective.ApiBase, response.Effective.Source},
				{"primary_model", response.Effective.Model, response.Effective.Source},
				{"fallback_model", response.Effective.FallbackModel, response.Effective.Source},
				{"stored_api_base", response.Stored.ApiBase, ""},
				{"stored_model", response.Stored.Model, ""},
				{"stored_fallback_model", response.Stored.FallbackModel, ""},
				{"stored_updated_by", response.Stored.UpdatedBy, ""},
				{"api_key", keyState, response.ApiKey.Masked},
			}

			return writeOutput(cmd, headers, rows, response)
		},
	}
}

func newAiConfigSetCmd() *cobra.Command {
	var apiBase string
	var model string
	var fallbackModel string
	var reason string

	setCmd := &cobra.Command{
		Use:   "set",
		Short: "Update AI routing settings (admin)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if strings.TrimSpace(apiBase) == "" && strings.TrimSpace(model) == "" && strings.TrimSpace(fallbackModel) == "" {
				return fmt.Errorf("at least one of --api-base, --model, or --fallback must be provided")
			}
			if strings.TrimSpace(model) != "" && !strings.Contains(model, "/") {
				return fmt.Errorf("--model must be provider/model form (e.g. openai/deepseek-v4-flash)")
			}
			if strings.TrimSpace(fallbackModel) != "" && !strings.Contains(fallbackModel, "/") {
				return fmt.Errorf("--fallback must be provider/model form (e.g. openai/deepseek-v4-flash-e)")
			}

			response, err := setAiRouting(context.Background(), newAPIClient(), client.AiRoutingUpdateRequest{
				ApiBase:       apiBase,
				Model:         model,
				FallbackModel: fallbackModel,
				Reason:        reason,
			})
			if err != nil {
				return err
			}

			headers := []string{"field", "value", "source"}
			rows := [][]string{
				{"api_base", response.Effective.ApiBase, response.Effective.Source},
				{"primary_model", response.Effective.Model, response.Effective.Source},
				{"fallback_model", response.Effective.FallbackModel, response.Effective.Source},
			}

			return writeOutput(cmd, headers, rows, response)
		},
	}

	setCmd.Flags().StringVar(&apiBase, "api-base", "", "API base URL (e.g. https://cpa.pt-mes.com/v1); empty clears to env")
	setCmd.Flags().StringVar(&model, "model", "", "Primary model in provider/model form; empty clears to env")
	setCmd.Flags().StringVar(&fallbackModel, "fallback", "", "Fallback model in provider/model form; empty clears to env")
	setCmd.Flags().StringVar(&reason, "reason", "", "Reason for the change (audit log)")

	return setCmd
}

func newAiConfigTestCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "test",
		Short: "Test connection to the effective AI endpoint",
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := testAiRouting(context.Background(), newAPIClient())
			if err != nil {
				return err
			}

			headers := []string{"field", "value"}
			rows := [][]string{
				{"model", response.Model},
				{"api_base", response.ApiBase},
				{"reachable", fmt.Sprintf("%t", response.Reachable)},
				{"model_found", fmt.Sprintf("%t", response.ModelFound)},
				{"chat_ok", fmt.Sprintf("%t", response.ChatOk != nil && *response.ChatOk)},
				{"warning", response.Warning},
			}

			return writeOutput(cmd, headers, rows, response)
		},
	}
}
