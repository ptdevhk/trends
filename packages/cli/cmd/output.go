package cmd

import (
	"encoding/json"
	"fmt"

	"github.com/ptdevhk/trends/packages/cli/internal/output"
	"github.com/spf13/cobra"
)

func writeOutput(cmd *cobra.Command, headers []string, rows [][]string, raw any) error {
	options := currentOptions()
	if options.Output == "json" {
		encoder := json.NewEncoder(cmd.OutOrStdout())
		encoder.SetIndent("", "  ")
		return encoder.Encode(raw)
	}

	formatter, err := output.NewFormatter(options.Output)
	if err != nil {
		return err
	}

	payload, err := formatter.Format(output.TabularData{
		Headers: headers,
		Rows:    rows,
	})
	if err != nil {
		return err
	}

	if _, err := cmd.OutOrStdout().Write(payload); err != nil {
		return err
	}

	if len(payload) == 0 || payload[len(payload)-1] != '\n' {
		if _, err := cmd.OutOrStdout().Write([]byte("\n")); err != nil {
			return err
		}
	}

	return nil
}

func writeMessage(cmd *cobra.Command, message string) error {
	options := currentOptions()
	if options.Output == "json" {
		return writeOutput(cmd, nil, nil, map[string]string{"message": message})
	}
	if options.Output == "agent" {
		return writeAgentFields(cmd, []output.Field{
			{Key: "kind", Value: "message"},
			{Key: "message", Value: message},
		})
	}
	_, err := fmt.Fprintln(cmd.OutOrStdout(), message)
	return err
}

func writeAgentFields(cmd *cobra.Command, fields []output.Field) error {
	line := output.FormatFields(fields)
	if line == "" {
		return nil
	}
	_, err := fmt.Fprintln(cmd.OutOrStdout(), line)
	return err
}

func writeAgentSummary(cmd *cobra.Command, fields []output.Field) error {
	return writeAgentFields(cmd, append([]output.Field{{Key: "kind", Value: "summary"}}, fields...))
}
