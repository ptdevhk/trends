# CN media resolver evaluation

A small Python standard-library workspace for evaluating whether Chinese media-share resolvers meet an anonymous, headless backend-automation contract.

## Scope

- Live anonymous WeChat Channels metadata capability probe.
- Static, commit-pinned candidate comparison.
- Strict URL classification for WeChat Channels, Douyin, and Xiaohongshu share forms.
- No credentials, media downloads, browser sessions, desktop interception, Docker, or third-party resolver calls.

Douyin and Xiaohongshu live parsing is intentionally not implemented yet. Their CLI options validate supported share-link forms and report `not_run_opt_in_only`; they do not claim resolution capability.

## Commands

```bash
python3 -m unittest discover -s tools/cn-media-resolver-eval -p 'test_*.py'

python3 tools/cn-media-resolver-eval/resolver_eval.py \
  --manifest tools/cn-media-resolver-eval/fixtures/candidates_manifest.json

python3 tools/cn-media-resolver-eval/resolver_eval.py \
  --wechat-url 'https://weixin.qq.com/sph/<share-id>'
```

Use `env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 ...` to prove a probe does not depend on inherited credentials.

## Safety properties

- HTTPS and exact host/path allowlists.
- Userinfo, IP literals, non-default ports, private destinations, and lookalike domains rejected.
- Redirects disabled for the official WeChat API request.
- Ten-second timeout and 256 KiB response ceiling.
- Dynamic request IDs.
- Reports omit input identifiers, descriptions, authors, cover URLs, raw responses, and media URLs.
- Candidate backend-safety classification is derived from license, anonymous media support, headless capability, credentials, desktop dependencies, subprocess use, and third-party APIs.
