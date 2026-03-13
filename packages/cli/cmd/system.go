package cmd

import (
	"context"
	"fmt"
	"strings"

	"github.com/ptdevhk/trends/packages/cli/internal/client"
	"github.com/spf13/cobra"
)

var getSystemMetadata = func(ctx context.Context, apiClient *client.Client) (*client.SystemMetadataResponse, error) {
	return apiClient.GetSystemMetadata(ctx)
}

var listSourceGroups = func(ctx context.Context, apiClient *client.Client) (*client.SourceGroupsResponse, error) {
	return apiClient.ListSourceGroups(ctx)
}

var getSourceDetail = func(ctx context.Context, apiClient *client.Client, key string) (*client.SourceDetailResponse, error) {
	return apiClient.GetSourceDetail(ctx, key)
}

func newSystemCmd() *cobra.Command {
	systemCmd := &cobra.Command{
		Use:   "system",
		Short: "Inspect system metadata and config sources",
	}

	systemCmd.AddCommand(
		newSystemMetadataCmd(),
		newSystemSourcesCmd(),
		newSystemSourceCmd(),
	)

	return systemCmd
}

func newSystemMetadataCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "metadata",
		Short: "Show system metadata and capabilities",
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := getSystemMetadata(context.Background(), newAPIClient())
			if err != nil {
				return err
			}

			headers := []string{"section", "value", "details"}
			rows := [][]string{
				{"app", response.Metadata.Identity.AppName, response.Metadata.Identity.AppVersion},
				{"api", response.Metadata.Identity.SystemTitle, response.Metadata.Identity.APIVersion},
				{"web", response.Metadata.Identity.SettingsTitle, response.Metadata.Identity.WebVersion},
				{"system_nav", fmt.Sprintf("%d", len(response.Metadata.Navigation.System)), joinNavIDs(response.Metadata.Navigation.System)},
				{"settings_nav", fmt.Sprintf("%d", len(response.Metadata.Navigation.Settings)), joinNavIDs(response.Metadata.Navigation.Settings)},
				{"debug_nav", fmt.Sprintf("%d", len(response.Metadata.Navigation.DebugPage)), joinNavIDs(response.Metadata.Navigation.DebugPage)},
				{"capabilities", fmt.Sprintf("%d", len(response.Metadata.Capabilities)), joinCapabilityIDs(response.Metadata.Capabilities)},
			}

			return writeOutput(cmd, headers, rows, response)
		},
	}
}

func newSystemSourcesCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "sources",
		Short: "List inspectable source groups",
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := listSourceGroups(context.Background(), newAPIClient())
			if err != nil {
				return err
			}

			headers := []string{"group", "audience", "sources", "description"}
			rows := make([][]string, 0, len(response.Groups))
			for _, group := range response.Groups {
				rows = append(rows, []string{
					group.Label,
					group.Audience,
					fmt.Sprintf("%d", len(group.Sources)),
					group.Description,
				})
			}

			return writeOutput(cmd, headers, rows, response)
		},
	}
}

func newSystemSourceCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "source <key>",
		Short: "Show one inspectable source",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := getSourceDetail(context.Background(), newAPIClient(), args[0])
			if err != nil {
				return err
			}

			headers := []string{"field", "value"}
			rows := [][]string{
				{"key", response.Source.Key},
				{"label", response.Source.Label},
				{"group", response.Source.Group},
				{"audience", response.Source.Audience},
				{"type", response.Source.Type},
				{"path", response.Source.RelativePath},
				{"read_only", fmt.Sprintf("%t", response.Source.ReadOnly)},
				{"raw_source", response.Source.RawSource},
				{"parse_error", response.Source.ParseError},
			}
			if response.Source.Metadata != nil {
				rows = append(rows,
					[]string{"version", intPointerString(response.Source.Metadata.Version)},
					[]string{"updated_at", response.Source.Metadata.UpdatedAt},
					[]string{"locale", response.Source.Metadata.Locale},
					[]string{"requested_locale", response.Source.Metadata.RequestedLocale},
					[]string{"resolved_locale", response.Source.Metadata.ResolvedSourceLocale},
					[]string{"fallback_to_zh_hans", boolPointerString(response.Source.Metadata.FallbackToZhHans)},
				)
			}

			return writeOutput(cmd, headers, rows, response)
		},
	}
}

func joinNavIDs(items []client.SystemNavItem) string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	return strings.Join(ids, ", ")
}

func joinCapabilityIDs(items []client.SystemCapabilityDescriptor) string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	return strings.Join(ids, ", ")
}

func intPointerString(value *int) string {
	if value == nil {
		return ""
	}
	return fmt.Sprintf("%d", *value)
}

func boolPointerString(value *bool) string {
	if value == nil {
		return ""
	}
	return fmt.Sprintf("%t", *value)
}
