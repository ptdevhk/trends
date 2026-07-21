package cmd

import (
	"context"
	"fmt"
	"strings"

	"github.com/spf13/cobra"
)

func newResearchCmd() *cobra.Command {
	researchCmd := &cobra.Command{
		Use:   "research",
		Short: "Research Eng company signals, ingest, and parity",
	}

	researchCmd.AddCommand(
		newResearchCompanyCmd(),
		newResearchIngestCmd(),
		newResearchParityCmd(),
	)
	return researchCmd
}

func newResearchCompanyCmd() *cobra.Command {
	var persona string

	cmd := &cobra.Command{
		Use:   "company <query>",
		Short: "Show company research signals (persona re-rank)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			query := strings.TrimSpace(args[0])
			if query == "" {
				return fmt.Errorf("query is required")
			}
			normalizedPersona := strings.ToLower(strings.TrimSpace(persona))
			if normalizedPersona == "" {
				normalizedPersona = "hr"
			}
			if normalizedPersona != "hr" && normalizedPersona != "sales" {
				return fmt.Errorf("invalid persona %q (expected hr|sales)", persona)
			}

			api := newAPIClient()
			ctx := context.Background()

			// Resolve query to companyKey via search when it is not already a key-like id
			companyKey := query
			search, err := api.SearchResearchCompanies(ctx, query)
			if err != nil {
				return err
			}
			if len(search.Items) > 0 {
				companyKey = search.Items[0].CompanyKey
			}

			signals, err := api.ListCompanyResearchSignals(ctx, companyKey, normalizedPersona)
			if err != nil {
				return err
			}

			headers := []string{"company_key", "persona", "kind", "title", "platform", "seen_at"}
			rows := make([][]string, 0, len(signals.Items))
			for _, item := range signals.Items {
				rows = append(rows, []string{
					item.CompanyKey,
					signals.Persona,
					item.Kind,
					item.Title,
					item.Evidence.Platform,
					fmt.Sprintf("%d", item.Evidence.SeenAt),
				})
			}
			return writeOutput(cmd, headers, rows, signals)
		},
	}

	cmd.Flags().StringVar(&persona, "persona", "hr", "Persona ranking: hr|sales")
	return cmd
}

func newResearchIngestCmd() *cobra.Command {
	var once bool

	cmd := &cobra.Command{
		Use:   "ingest",
		Short: "Trigger Research Eng native ingest via API (operator)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !once {
				return fmt.Errorf("only --once is supported for operator trigger")
			}
			response, err := newAPIClient().TriggerResearchIngest(context.Background())
			if err != nil {
				return err
			}
			headers := []string{"mode", "started_at", "finished_at", "message"}
			rows := [][]string{{response.Mode, response.StartedAt, response.FinishedAt, response.Message}}
			return writeOutput(cmd, headers, rows, response)
		},
	}
	cmd.Flags().BoolVar(&once, "once", true, "Run ingest once immediately")
	return cmd
}

func newResearchParityCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "parity",
		Short: "Show latest research parity run (kill-switch ledger)",
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := newAPIClient().GetResearchParity(context.Background())
			if err != nil {
				return err
			}
			headers := []string{"success"}
			rows := [][]string{{fmt.Sprintf("%v", response.Success)}}
			return writeOutput(cmd, headers, rows, response)
		},
	}
}
