package client

import (
	"context"
	"fmt"
	"net/http"
)

// AiRoutingSettings is the effective + stored AI routing view returned by the
// BFF. It never contains the API key value.
type AiRoutingSettings struct {
	Success bool `json:"success"`
	Effective struct {
		ApiBase        string `json:"apiBase"`
		Model          string `json:"model"`
		FallbackModel  string `json:"fallbackModel"`
		Source         string `json:"source"`
	} `json:"effective"`
	Stored struct {
		ApiBase       string `json:"apiBase"`
		Model         string `json:"model"`
		FallbackModel string `json:"fallbackModel"`
		UpdatedBy     string `json:"updatedBy"`
		UpdatedAt     int64  `json:"updatedAt"`
	} `json:"stored"`
	ApiKey struct {
		Present bool   `json:"present"`
		Masked  string `json:"masked"`
	} `json:"apiKey"`
	CuratedModels []string `json:"curatedModels"`
}

type AiRoutingTestResult struct {
	Success     bool   `json:"success"`
	Model       string `json:"model"`
	ApiBase     string `json:"apiBase"`
	Reachable   bool   `json:"reachable"`
	ModelFound  bool   `json:"modelFound"`
	ChatOk      *bool  `json:"chatOk"`
	Warning     string `json:"warning"`
}

type AiRoutingTestResponse struct {
	Success bool                `json:"success"`
	Result  AiRoutingTestResult `json:"result"`
}

// The test endpoint responds at top level with the test fields, so expose a
// looser struct that can hold either shape.
type AiRoutingTestRaw struct {
	Success    bool   `json:"success"`
	Model      string `json:"model"`
	ApiBase    string `json:"apiBase"`
	Reachable  bool   `json:"reachable"`
	ModelFound bool   `json:"modelFound"`
	ChatOk     *bool  `json:"chatOk"`
	Warning    string `json:"warning"`
}

type AiRoutingUpdateRequest struct {
	ApiBase       string `json:"apiBase,omitempty"`
	Model         string `json:"model,omitempty"`
	FallbackModel string `json:"fallbackModel,omitempty"`
	Reason        string `json:"reason,omitempty"`
}

func (c *Client) GetAiRouting(ctx context.Context) (*AiRoutingSettings, error) {
	endpoint := fmt.Sprintf("%s/api/config/ai-routing", c.APIURL)
	var response AiRoutingSettings
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("ai-routing get request was not successful")
	}
	return &response, nil
}

func (c *Client) SetAiRouting(ctx context.Context, request AiRoutingUpdateRequest) (*AiRoutingSettings, error) {
	endpoint := fmt.Sprintf("%s/api/config/ai-routing", c.APIURL)
	var response AiRoutingSettings
	if err := c.doJSON(ctx, http.MethodPut, endpoint, request, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("ai-routing set request was not successful")
	}
	return &response, nil
}

func (c *Client) TestAiRouting(ctx context.Context) (*AiRoutingTestRaw, error) {
	endpoint := fmt.Sprintf("%s/api/config/ai-routing/test", c.APIURL)
	var response AiRoutingTestRaw
	if err := c.doJSON(ctx, http.MethodPost, endpoint, nil, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("ai-routing test request was not successful")
	}
	return &response, nil
}
