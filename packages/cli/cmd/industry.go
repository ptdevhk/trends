package cmd

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/ptdevhk/trends/packages/cli/internal/client"
	"github.com/spf13/cobra"
)

var industryProposalStatuses = map[string]struct{}{
	"new": {}, "researching": {}, "ready_for_review": {},
	"needs_more_evidence": {}, "approved": {}, "rejected": {}, "superseded": {},
}

func newIndustryCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "industry",
		Short: "Prepare human review for industry verification proposals",
		Long:  "Read-only industry review tools. Recommendations and source preselection are shared with the admin UI; final approval remains a human-only admin action.",
	}
	cmd.AddCommand(
		newIndustryReviewCmd(),
		newIndustryInspectCmd(),
		newIndustryRecommendCmd(),
		newIndustryPacketAliasCmd(),
		newIndustryOpenCmd(),
	)
	return cmd
}

func newIndustryReviewCmd() *cobra.Command {
	var status string
	var limit int
	var cursor string
	var riskFlag string
	var confidenceBand string
	var recommendedAction string
	cmd := &cobra.Command{
		Use:   "review",
		Short: "List proposals with deterministic review recommendations",
		RunE: func(cmd *cobra.Command, args []string) error {
			normalizedStatus, err := normalizeIndustryProposalStatus(status)
			if err != nil {
				return err
			}
			if limit < 1 || limit > 100 {
				return fmt.Errorf("invalid --limit %d (expected 1..100)", limit)
			}
			response, err := newAPIClient().ListIndustryReviewQueuePage(
				context.Background(), normalizedStatus, limit, cursor, riskFlag, confidenceBand, recommendedAction,
			)
			if err != nil {
				return err
			}
			headers := []string{"proposal_id", "employer", "status", "recommended_action", "confidence", "industry_class", "sources", "risk_flags"}
			rows := make([][]string, 0, len(response.Items))
			for _, item := range response.Items {
				rows = append(rows, []string{
					item.Proposal.ProposalID,
					industryEmployerLabel(item.Proposal),
					item.Proposal.Status,
					item.Recommendation.RecommendedAction,
					item.Recommendation.ConfidenceBand,
					item.Recommendation.RecommendedIndustryClass,
					strconv.Itoa(item.SourceCount),
					strings.Join(item.Recommendation.RiskFlags, ","),
				})
			}
			return writeOutput(cmd, headers, rows, response)
		},
	}
	cmd.Flags().StringVar(&status, "status", "ready_for_review", "Proposal status to review")
	cmd.Flags().IntVar(&limit, "limit", 20, "Maximum proposals to fetch (1..100)")
	cmd.Flags().StringVar(&cursor, "cursor", "", "Continue from a previous bounded review queue page")
	cmd.Flags().StringVar(&riskFlag, "risk-flag", "", "Filter by one visible review risk flag")
	cmd.Flags().StringVar(&confidenceBand, "confidence", "", "Filter by recommendation confidence")
	cmd.Flags().StringVar(&recommendedAction, "action", "", "Filter by recommended action")
	return cmd
}

func newIndustryInspectCmd() *cobra.Command {
	return newIndustryPacketCmd("inspect", "Inspect a complete human review packet", false)
}

func newIndustryRecommendCmd() *cobra.Command {
	return newIndustryPacketCmd("recommend", "Show the shared recommendation and preselected sources", true)
}

func newIndustryPacketAliasCmd() *cobra.Command {
	return newIndustryPacketCmd("review-packet", "Inspect the complete shared review packet", false)
}

func newIndustryPacketCmd(name string, short string, recommendationOnly bool) *cobra.Command {
	return &cobra.Command{
		Use:   name + " <proposal-id>",
		Short: short,
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			headers := []string{"proposal_id", "employer", "status", "recommended_action", "confidence", "industry_class", "recommended_sources", "risk_flags", "warnings"}
			if recommendationOnly {
				recommendation, err := newAPIClient().GetIndustryReviewRecommendation(context.Background(), args[0])
				if err != nil {
					return err
				}
				row := industryRecommendationRow(recommendation.Recommendation, industryWarningsSummary(recommendation.Warnings))
				return writeOutput(cmd, headers, [][]string{row}, recommendation)
			}
			packet, err := newAPIClient().GetIndustryReviewPacket(context.Background(), args[0])
			if err != nil {
				return err
			}
			rows := [][]string{{
				packet.Proposal.ProposalID,
				industryEmployerLabel(packet.Proposal),
				packet.Proposal.Status,
				packet.Recommendation.RecommendedAction,
				packet.Recommendation.ConfidenceBand,
				packet.Recommendation.RecommendedIndustryClass,
				strings.Join(packet.Recommendation.RecommendedSourceIDs, ","),
				strings.Join(packet.Recommendation.RiskFlags, ","),
				industryWarningsSummary(packet.Warnings),
			}}
			return writeOutput(cmd, headers, rows, packet)
		},
	}
}

func industryRecommendationRow(
	recommendation client.IndustryReviewRecommendation,
	warnings string,
) []string {
	return []string{
		recommendation.ProposalID,
		"recommendation-only",
		recommendation.ProposalStatus,
		recommendation.RecommendedAction,
		recommendation.ConfidenceBand,
		recommendation.RecommendedIndustryClass,
		strings.Join(recommendation.RecommendedSourceIDs, ","),
		strings.Join(recommendation.RiskFlags, ","),
		warnings,
	}
}

func newIndustryOpenCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "open <proposal-id>",
		Short: "Print the admin review URL (does not approve)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			proposalID := strings.TrimSpace(args[0])
			if proposalID == "" {
				return fmt.Errorf("proposal ID is required")
			}
			webURL := strings.TrimRight(strings.TrimSpace(currentOptions().WebURL), "/")
			if webURL == "" {
				return fmt.Errorf("admin web URL is empty; set --web-url or TRENDS_WEB_URL")
			}
			link := client.IndustryReviewOpenLink{
				ProposalID: proposalID,
				URL:        webURL + "/admin/system/settings/industry-verification?proposalId=" + url.QueryEscape(proposalID),
				Action:     "Open the link and perform the final human approval in the admin UI.",
			}
			return writeOutput(cmd, []string{"proposal_id", "url", "action"}, [][]string{{link.ProposalID, link.URL, link.Action}}, link)
		},
	}
}

func normalizeIndustryProposalStatus(value string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		return "ready_for_review", nil
	}
	if _, ok := industryProposalStatuses[normalized]; !ok {
		return "", fmt.Errorf("invalid --status %q", value)
	}
	return normalized, nil
}

func industryEmployerLabel(proposal client.IndustryReviewProposal) string {
	if proposal.CompanyKey != "" {
		return proposal.CompanyKey
	}
	if proposal.NormalizedEmployerSurface != "" {
		return proposal.NormalizedEmployerSurface
	}
	return "unresolved"
}

func industryWarningsSummary(warnings []client.IndustryReviewWarning) string {
	parts := make([]string, 0, len(warnings))
	for _, warning := range warnings {
		if warning.Code != "" {
			parts = append(parts, warning.Code)
		} else if warning.Message != "" {
			parts = append(parts, warning.Message)
		}
	}
	return strings.Join(parts, ",")
}
