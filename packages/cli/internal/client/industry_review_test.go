package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestListIndustryReviewQueueUsesSharedReviewEndpoint(t *testing.T) {
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.RequestURI()
		if r.Method != http.MethodGet {
			t.Fatalf("expected GET, got %s", r.Method)
		}
		_ = json.NewEncoder(w).Encode(IndustryReviewQueueResponse{
			Success: true, OK: true, SchemaVersion: "industry-review.v1",
			Items: []IndustryReviewQueueItem{{
				Proposal:       IndustryReviewProposal{ProposalID: "proposal-1", Status: "ready_for_review"},
				Recommendation: IndustryReviewRecommendation{ProposalID: "proposal-1", RecommendedAction: "approve"},
				SourceCount:    1,
			}},
		})
	}))
	defer server.Close()

	response, err := New(server.URL, server.URL, "dev").ListIndustryReviewQueue(context.Background(), "ready_for_review", 20)
	if err != nil {
		t.Fatalf("ListIndustryReviewQueue returned error: %v", err)
	}
	if gotPath != "/api/company-industry-proposals/review-queue?limit=20&status=ready_for_review" {
		t.Fatalf("unexpected request path: %s", gotPath)
	}
	if len(response.Items) != 1 || response.Items[0].Recommendation.RecommendedAction != "approve" {
		t.Fatalf("unexpected queue response: %+v", response)
	}
}

func TestGetIndustryReviewPacketEscapesProposalID(t *testing.T) {
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_ = json.NewEncoder(w).Encode(IndustryReviewPacket{
			Success: true, OK: true, SchemaVersion: "industry-review.v1",
			Proposal:       IndustryReviewProposal{ProposalID: "proposal/1"},
			Recommendation: IndustryReviewRecommendation{ProposalID: "proposal/1", RequiresHumanReview: true},
		})
	}))
	defer server.Close()

	response, err := New(server.URL, server.URL, "dev").GetIndustryReviewPacket(context.Background(), " proposal/1 ")
	if err != nil {
		t.Fatalf("GetIndustryReviewPacket returned error: %v", err)
	}
	if gotPath != "/api/company-industry-proposals/proposal%2F1/review-packet" && gotPath != "/api/company-industry-proposals/proposal/1/review-packet" {
		t.Fatalf("unexpected escaped path: %s", gotPath)
	}
	if response.Recommendation.RequiresHumanReview != true {
		t.Fatal("expected recommendation to require human review")
	}
}

func TestGetIndustryReviewPacketRequiresProposalID(t *testing.T) {
	_, err := New("http://localhost:3000", "http://localhost:8000", "dev").GetIndustryReviewPacket(context.Background(), "  ")
	if err == nil || !strings.Contains(err.Error(), "proposal ID is required") {
		t.Fatalf("expected proposal ID validation error, got %v", err)
	}
}
