---
name: play-creative-assets
description: Generate, inspect, transform, and validate Google Play icons, feature graphics, and screenshots while preserving truthful representation of the app.
---
# Play Creative Assets

## Principles
- Preserve originals and create derivatives.
- Actual app screenshots must depict real app UI.
- Never fabricate fictional UI and label it as a screenshot.
- Use image generation for original illustrative/branding art when appropriate, but not to invent app functionality.
- Ask for logos/brand files when faithful reproduction depends on them.

## Baseline asset checks
Icon: 512x512 PNG, <=1024KB.
Feature graphic: 1024x500 JPEG/24-bit PNG, no alpha.
Screenshots: minimum two across supported device types; 320-3840px; max dimension <= 2x min dimension; no alpha. Prefer at least four 1080px screenshots for stronger discovery eligibility. Re-verify live.

## Repair sequence
Inspect -> explain exact failure -> smallest transform -> validate output -> compare visual fidelity -> return new artifact.

## Screenshot composition
Use real screenshot as dominant content. A branded canvas/headline is allowed. Keep the first screens focused on actual UI and core value.
