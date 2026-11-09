# TiinyDev
Collection of dev projects for Tiiny Pocket Lab.

## Tiiny Video

[Tiiny Video](Video/tiiny_video.html) is a standalone browser interface for generating clips on a Tiiny Pocket Lab with MiniMax H3 Turbo.

1. Open the HTML file in a browser that can reach your Tiiny. Open **API settings** beside the title and enter your API key. The default API base URL is `http://openai.api.tiiny/v1`.
2. Enter a prompt and choose a size, duration, and step count. You can also click or drag a PNG, JPEG, or WebP into the reference image area to guide the opening frame.
3. Select **Generate video**. When the clip is ready, play it in the preview or select **Download MP4**.

| Aspect | Standard | Large |
| --- | --- | --- |
| Landscape | 832 × 480 | 1344 × 768 |
| Portrait | 480 × 832 | 768 × 1344 |

> **Allow time for generation.** A recorded standard-size run took about eight minutes. Progress can stay at the same percentage for a while, and the page's time estimate is approximate. Keep the page open and avoid refreshing while it monitors the job. Larger sizes can take considerably longer and may fail even though the model supports them. Start with a short clip at a standard size, or fall back to the standard size if a large job fails.
