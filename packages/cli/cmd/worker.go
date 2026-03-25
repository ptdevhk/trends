package cmd

import (
	"context"
	"fmt"
	"strings"

	"github.com/ptdevhk/trends/packages/cli/internal/client"
	"github.com/spf13/cobra"
)

func newWorkerCmd() *cobra.Command {
	workerCmd := &cobra.Command{
		Use:   "worker",
		Short: "Worker operations",
	}

	workerCmd.AddCommand(
		newWorkerStatusCmd(),
		newWorkerRunCmd(),
		newWorkerSummaryCmd(),
	)

	return workerCmd
}

func newWorkerSummaryCmd() *cobra.Command {
	summaryCmd := &cobra.Command{
		Use:   "summary",
		Short: "Workspace summary operations",
	}

	summaryCmd.AddCommand(
		newWorkerSummaryRunCmd(),
		newWorkerSummaryHistoryCmd(),
		newWorkerSummaryShowCmd(),
	)

	return summaryCmd
}

func newWorkerSummaryRunCmd() *cobra.Command {
	var channel string
	var dryRun bool
	var templateID string
	var endAt string
	var to string
	var subject string
	var webhookURL string
	var botToken string
	var chatID string
	var viaWorker bool

	cmd := &cobra.Command{
		Use:   "run",
		Short: "Run a workspace summary manually",
		RunE: func(cmd *cobra.Command, args []string) error {
			request := client.SummaryRunRequest{
				Channel:       channel,
				DryRun:        dryRun,
				TemplateID:    templateID,
				EndAt:         endAt,
				To:            to,
				Subject:       subject,
				WebhookURL:    webhookURL,
				BotToken:      botToken,
				ChatID:        chatID,
				TriggerSource: "api_manual",
			}

			if viaWorker {
				response, err := newAPIClient().TriggerWorkerSummary(context.Background(), request)
				if err != nil {
					return err
				}
				headers := []string{"mode", "started_at", "finished_at", "message"}
				rows := [][]string{{response.Mode, response.StartedAt, response.FinishedAt, response.Message}}
				return writeOutput(cmd, headers, rows, response)
			}

			response, err := newAPIClient().RunWorkspaceSummary(context.Background(), request)
			if err != nil {
				return err
			}
			headers := []string{"run_id", "status", "channel", "dry_run", "trigger_source", "window_end", "delivery"}
			rows := [][]string{{
				response.Run.ID,
				response.Run.Status,
				response.Channel,
				boolToString(response.DryRun),
				response.Run.TriggerSource,
				response.Run.WindowEnd,
				summaryDeliverySummary(response.Delivery),
			}}
			return writeOutput(cmd, headers, rows, response)
		},
	}

	cmd.Flags().StringVar(&channel, "channel", "telegram", "Summary delivery channel")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "Render without sending externally")
	cmd.Flags().StringVar(&templateID, "template-id", "", "Optional notification template ID")
	cmd.Flags().StringVar(&endAt, "end-at", "", "Optional ISO8601 end time")
	cmd.Flags().StringVar(&to, "to", "", "Optional email recipient for email channel")
	cmd.Flags().StringVar(&subject, "subject", "", "Optional message subject override")
	cmd.Flags().StringVar(&webhookURL, "webhook-url", "", "Optional webhook override for WeChat Work or Feishu")
	cmd.Flags().StringVar(&botToken, "bot-token", "", "Optional Telegram bot token override")
	cmd.Flags().StringVar(&chatID, "chat-id", "", "Optional Telegram chat ID override")
	cmd.Flags().BoolVar(&viaWorker, "via-worker", false, "Trigger through the worker summary endpoint instead of the API summary route")
	return cmd
}

func newWorkerSummaryHistoryCmd() *cobra.Command {
	var limit int

	cmd := &cobra.Command{
		Use:   "history",
		Short: "List persisted workspace summary runs",
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := newAPIClient().ListWorkspaceSummaryRuns(context.Background(), limit)
			if err != nil {
				return err
			}

			headers := []string{"id", "status", "channel", "dry_run", "trigger_source", "started_at", "window_end", "delivery"}
			rows := make([][]string, 0, len(response.Items))
			for _, item := range response.Items {
				rows = append(rows, []string{
					item.ID,
					item.Status,
					item.Channel,
					boolToString(item.DryRun),
					item.TriggerSource,
					item.StartedAt,
					item.WindowEnd,
					summaryDeliverySummary(item.Delivery),
				})
			}
			return writeOutput(cmd, headers, rows, response)
		},
	}

	cmd.Flags().IntVar(&limit, "limit", 20, "Maximum summary runs to fetch")
	return cmd
}

func newWorkerSummaryShowCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "show <run-id>",
		Short: "Show one persisted workspace summary run",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := newAPIClient().GetWorkspaceSummaryRun(context.Background(), args[0])
			if err != nil {
				return err
			}

			headers := []string{"id", "status", "channel", "dry_run", "trigger_source", "started_at", "finished_at", "delivery", "accounts", "error"}
			rows := [][]string{{
				response.Item.ID,
				response.Item.Status,
				response.Item.Channel,
				boolToString(response.Item.DryRun),
				response.Item.TriggerSource,
				response.Item.StartedAt,
				response.Item.FinishedAt,
				summaryDeliverySummary(response.Item.Delivery),
				summaryDeliveryAccounts(response.Item.Delivery),
				emptyDash(response.Item.Error),
			}}
			return writeOutput(cmd, headers, rows, response)
		},
	}

	return cmd
}

func newWorkerStatusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Get worker status",
		RunE: func(cmd *cobra.Command, args []string) error {
			status, err := newAPIClient().WorkerStatus(context.Background())
			if err != nil {
				return err
			}

			headers := []string{"running", "jobs_executed", "jobs_failed", "jobs_missed", "last_run", "last_success", "last_failure"}
			rows := [][]string{{
				boolToString(status.Running),
				fmt.Sprintf("%d", status.JobsExecuted),
				fmt.Sprintf("%d", status.JobsFailed),
				fmt.Sprintf("%d", status.JobsMissed),
				status.LastRun,
				status.LastSuccess,
				status.LastFailure,
			}}
			return writeOutput(cmd, headers, rows, status)
		},
	}
}

func newWorkerRunCmd() *cobra.Command {
	var once bool

	cmd := &cobra.Command{
		Use:   "run",
		Short: "Trigger worker run",
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := newAPIClient().RunWorker(context.Background(), once)
			if err != nil {
				return err
			}

			headers := []string{"mode", "started_at", "finished_at", "message"}
			rows := [][]string{{response.Mode, response.StartedAt, response.FinishedAt, response.Message}}
			return writeOutput(cmd, headers, rows, response)
		},
	}

	cmd.Flags().BoolVar(&once, "once", true, "Run once immediately")
	return cmd
}

func summaryDeliverySummary(delivery *client.SummaryDelivery) string {
	if delivery == nil {
		return "-"
	}

	if delivery.MessageID != "" {
		return "message:" + delivery.MessageID
	}

	if delivery.AccountsSelected > 0 || delivery.AccountsAttempted > 0 || delivery.AccountsSent > 0 {
		denominator := delivery.AccountsAttempted
		if denominator == 0 {
			denominator = delivery.AccountsSelected
		}
		if denominator == 0 {
			denominator = delivery.AccountsConfigured
		}

		parts := []string{fmt.Sprintf("%d/%d sent", delivery.AccountsSent, denominator)}
		if delivery.TotalBatches > 0 {
			parts = append(parts, fmt.Sprintf("%d batches", delivery.TotalBatches))
		}
		if delivery.UsedOverrideBotToken || delivery.UsedOverrideChatID {
			parts = append(parts, "override")
		}
		return strings.Join(parts, ", ")
	}

	if delivery.Channel != "" {
		return delivery.Channel
	}
	if delivery.OK {
		return "ok"
	}

	return "available"
}

func summaryDeliveryAccounts(delivery *client.SummaryDelivery) string {
	if delivery == nil || len(delivery.Accounts) == 0 {
		return "-"
	}

	parts := make([]string, 0, len(delivery.Accounts))
	for _, account := range delivery.Accounts {
		status := "skipped"
		if account.Sent {
			status = "sent"
		} else if account.Attempted {
			status = "failed"
		}

		part := fmt.Sprintf("%d:%s:%s", account.Index, account.ChatIDHint, status)
		if account.BatchesPlanned > 0 {
			part += fmt.Sprintf("(%db)", account.BatchesPlanned)
		}
		parts = append(parts, part)
	}

	return strings.Join(parts, ", ")
}

func emptyDash(value string) string {
	if strings.TrimSpace(value) == "" {
		return "-"
	}
	return value
}
