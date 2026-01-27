"""
Base AI Provider Plugin Interface

All custom AI providers should inherit from BaseAIProvider and implement
the required methods. Note: The main trendradar application uses LiteLLM
which already supports 100+ providers. This plugin system is for adding
providers not supported by LiteLLM or for custom implementations.

Example:
    import os
    from plugins.ai_providers.base import BaseAIProvider, AIResponse

    class MyAIProvider(BaseAIProvider):
        name = "my_ai"
        display_name = "My AI Provider"
        env_keys = ["MY_AI_API_KEY"]

        def complete(self, prompt: str, **kwargs) -> AIResponse:
            api_key = os.environ.get("MY_AI_API_KEY")
            # Call your AI API...
            return AIResponse(
                content="AI generated response",
                model="my-model",
                usage={"prompt_tokens": 100, "completion_tokens": 50}
            )
"""

import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class AIResponse:
    """Result of an AI completion request."""

    content: str
    model: str
    usage: dict[str, int] = field(default_factory=dict)
    finish_reason: str = "stop"
    error: str | None = None
    raw_response: Any = None

    def __bool__(self) -> bool:
        return self.error is None and bool(self.content)


class BaseAIProvider(ABC):
    """
    Abstract base class for AI provider plugins.

    All custom AI providers must inherit from this class and implement:
        - name: Unique identifier for the provider
        - complete(): Method to get AI completions

    Optional:
        - env_keys: List of required environment variable names
        - display_name: Human-readable name
        - is_configured(): Check if provider is properly configured
        - get_models(): List available models
    """

    # Required: Unique identifier for the provider
    name: str = ""

    # Optional: Human-readable display name
    display_name: str = ""

    # Optional: Description of the provider
    description: str = ""

    # Optional: List of required environment variable names
    env_keys: list[str] = []

    # Optional: Default model to use
    default_model: str = ""

    def __init__(self, config: dict | None = None):
        """Initialize the provider with optional config."""
        self._config = config or {}
        self.configure(self._config)

    def configure(self, config: dict) -> None:
        """
        Configure the provider with settings from config.yaml.

        Override this method to handle custom configuration options.

        Args:
            config: The full configuration dictionary
        """
        pass

    @abstractmethod
    def complete(self, prompt: str, **kwargs: Any) -> AIResponse:
        """
        Generate a completion for the given prompt.

        Args:
            prompt: The input prompt
            **kwargs: Additional options (model, temperature, max_tokens, etc.)

        Returns:
            AIResponse with the generated content
        """
        raise NotImplementedError

    def is_configured(self) -> bool:
        """
        Check if this provider is properly configured.

        Default implementation checks if all required env vars are set.

        Returns:
            True if provider can be used
        """
        return all(os.environ.get(key) for key in self.env_keys)

    def is_enabled(self, config: dict) -> bool:
        """
        Check if this provider is enabled in the configuration.

        Args:
            config: The full configuration dictionary

        Returns:
            True if provider should be used
        """
        return self.is_configured()

    def get_models(self) -> list[str]:
        """
        Get list of available models from this provider.

        Returns:
            List of model identifiers
        """
        return [self.default_model] if self.default_model else []

    def get_display_name(self) -> str:
        """Get human-readable display name."""
        return self.display_name or self.name.replace("_", " ").title()

    def analyze(self, content: str, **kwargs: Any) -> AIResponse:
        """
        Analyze content (news, text, etc.) using AI.

        Default implementation wraps complete() with analysis prompt.

        Args:
            content: The content to analyze
            **kwargs: Additional options

        Returns:
            AIResponse with analysis
        """
        prompt = kwargs.pop("analysis_prompt", "Analyze the following content:\n\n")
        return self.complete(prompt + content, **kwargs)

    def translate(
        self, content: str, target_language: str = "en", **kwargs: Any
    ) -> AIResponse:
        """
        Translate content to target language.

        Default implementation wraps complete() with translation prompt.

        Args:
            content: The content to translate
            target_language: Target language code (e.g., "en", "zh")
            **kwargs: Additional options

        Returns:
            AIResponse with translation
        """
        prompt = f"Translate the following to {target_language}:\n\n"
        return self.complete(prompt + content, **kwargs)
