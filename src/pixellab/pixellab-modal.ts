/**
 * PixelLab generation modal — UI for generating characters with AI.
 * Shows description field, optional reference photo, API key, palette preview,
 * tagged pose summary, and generation progress.
 */

import type { LayerGroup } from '../editor/layer-model';
import type { CapturedPose } from '../editor/sprite-analyzer';
import type { PoseAnimTag, AnimationTemplateId } from './pixellab-types';
import { ANIMATION_LABELS } from './pixellab-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenerateConfig {
  description: string;
  apiKey: string;
  referencePhoto: File | null;
  referenceStrength: number;
}

export interface PixelLabModalCallbacks {
  onGenerate(config: GenerateConfig): void;
  onCancel(): void;
}

// ---------------------------------------------------------------------------
// LocalStorage keys
// ---------------------------------------------------------------------------

const LS_API_KEY = 'pixellab_api_key';
const LS_DESCRIPTION = 'pixellab_last_description';

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function createPixelLabModal(
  group: LayerGroup,
  callbacks: PixelLabModalCallbacks,
): HTMLElement {
  const capture = group.spriteCapture;
  if (!capture) throw new Error('No sprite capture in group');

  const poses = capture.poses;
  const tags = capture.poseAnimTags ?? [];
  const palette = capture.palette;

  // Count tagged poses by template
  const tagCounts = new Map<AnimationTemplateId, number>();
  for (const tag of tags) {
    if (!tag) continue;
    tagCounts.set(tag.template, (tagCounts.get(tag.template) ?? 0) + 1);
  }
  const taggedCount = tags.filter(t => t !== null).length;

  // Build modal DOM
  const overlay = document.createElement('div');
  overlay.className = 'pixellab-modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'pixellab-modal';

  // Title
  const title = document.createElement('h2');
  title.textContent = 'Generate with PixelLab';
  dialog.appendChild(title);

  // Description
  const descLabel = document.createElement('label');
  descLabel.textContent = 'Character description';
  dialog.appendChild(descLabel);

  const descInput = document.createElement('textarea');
  descInput.className = 'pixellab-desc';
  descInput.rows = 3;
  descInput.placeholder = 'e.g. "obese black man wearing white gi with black belt, barefoot, red headband"';
  descInput.value = localStorage.getItem(LS_DESCRIPTION) ?? '';
  dialog.appendChild(descInput);

  // Reference photo (optional)
  const photoLabel = document.createElement('label');
  photoLabel.textContent = 'Reference photo (optional — face reference)';
  dialog.appendChild(photoLabel);

  const photoRow = document.createElement('div');
  photoRow.className = 'pixellab-photo-row';

  const photoInput = document.createElement('input');
  photoInput.type = 'file';
  photoInput.accept = 'image/*';
  photoRow.appendChild(photoInput);

  const photoPreview = document.createElement('img');
  photoPreview.className = 'pixellab-photo-preview';
  photoPreview.style.display = 'none';
  photoRow.appendChild(photoPreview);

  let selectedFile: File | null = null;
  photoInput.onchange = () => {
    const file = photoInput.files?.[0] ?? null;
    selectedFile = file;
    if (file) {
      const url = URL.createObjectURL(file);
      photoPreview.src = url;
      photoPreview.style.display = 'block';
    } else {
      photoPreview.style.display = 'none';
    }
  };

  dialog.appendChild(photoRow);

  // Reference strength slider
  const strengthLabel = document.createElement('label');
  strengthLabel.textContent = 'Photo fidelity';
  dialog.appendChild(strengthLabel);

  const strengthRow = document.createElement('div');
  strengthRow.className = 'pixellab-strength-row';

  const strengthSlider = document.createElement('input');
  strengthSlider.type = 'range';
  strengthSlider.min = '100';
  strengthSlider.max = '999';
  strengthSlider.value = '300';
  strengthRow.appendChild(strengthSlider);

  const strengthValue = document.createElement('span');
  strengthValue.textContent = '300';
  strengthSlider.oninput = () => { strengthValue.textContent = strengthSlider.value; };
  strengthRow.appendChild(strengthValue);

  dialog.appendChild(strengthRow);

  // API Key
  const keyLabel = document.createElement('label');
  keyLabel.textContent = 'PixelLab API Key';
  dialog.appendChild(keyLabel);

  const keyInput = document.createElement('input');
  keyInput.type = 'password';
  keyInput.className = 'pixellab-api-key';
  keyInput.placeholder = 'sk-...';
  keyInput.value = localStorage.getItem(LS_API_KEY) ?? '';
  dialog.appendChild(keyInput);

  // Palette preview
  const palSection = document.createElement('div');
  palSection.className = 'pixellab-palette-section';
  const palLabel = document.createElement('label');
  palLabel.textContent = `Palette #${palette}`;
  palSection.appendChild(palLabel);

  const palStrip = document.createElement('div');
  palStrip.className = 'pixellab-palette-strip';
  // Use capturedColors from first pose if available
  const colors = poses[0]?.capturedColors;
  if (colors) {
    for (let i = 0; i < 16; i++) {
      const swatch = document.createElement('div');
      swatch.className = 'pixellab-swatch';
      const [r, g, b] = colors[i] ?? [0, 0, 0];
      swatch.style.background = i === 15 ? 'transparent' : `rgb(${r},${g},${b})`;
      if (i === 15) swatch.style.border = '1px dashed #555';
      palStrip.appendChild(swatch);
    }
  }
  palSection.appendChild(palStrip);
  dialog.appendChild(palSection);

  // Tagged poses summary
  const tagSection = document.createElement('div');
  tagSection.className = 'pixellab-tag-summary';
  const tagLabel = document.createElement('label');
  tagLabel.textContent = `Tagged poses (${taggedCount}/${poses.length})`;
  tagSection.appendChild(tagLabel);

  const tagList = document.createElement('div');
  tagList.className = 'pixellab-tag-list';
  for (const [tmpl, count] of tagCounts) {
    const chip = document.createElement('span');
    chip.className = 'pixellab-tag-chip';
    chip.textContent = `${ANIMATION_LABELS[tmpl]} ×${count}`;
    tagList.appendChild(chip);
  }
  tagSection.appendChild(tagList);
  dialog.appendChild(tagSection);

  // Progress (hidden initially)
  const progressSection = document.createElement('div');
  progressSection.className = 'pixellab-progress';
  progressSection.style.display = 'none';

  const progressBar = document.createElement('div');
  progressBar.className = 'pixellab-progress-bar';
  const progressFill = document.createElement('div');
  progressFill.className = 'pixellab-progress-fill';
  progressBar.appendChild(progressFill);
  progressSection.appendChild(progressBar);

  const progressText = document.createElement('div');
  progressText.className = 'pixellab-progress-text';
  progressText.textContent = 'Generating...';
  progressSection.appendChild(progressText);

  dialog.appendChild(progressSection);

  // Buttons
  const btnRow = document.createElement('div');
  btnRow.className = 'pixellab-btn-row';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'pixellab-cancel-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => callbacks.onCancel();
  btnRow.appendChild(cancelBtn);

  const genBtn = document.createElement('button');
  genBtn.className = 'pixellab-generate-btn';
  genBtn.textContent = 'Generate';
  genBtn.disabled = taggedCount === 0;
  genBtn.onclick = () => {
    const desc = descInput.value.trim();
    const key = keyInput.value.trim();
    if (!desc) { descInput.focus(); return; }
    if (!key) { keyInput.focus(); return; }

    // Save to localStorage
    localStorage.setItem(LS_API_KEY, key);
    localStorage.setItem(LS_DESCRIPTION, desc);

    // Show progress, disable button
    genBtn.disabled = true;
    progressSection.style.display = '';

    callbacks.onGenerate({
      description: desc,
      apiKey: key,
      referencePhoto: selectedFile,
      referenceStrength: parseInt(strengthSlider.value, 10),
    });
  };
  btnRow.appendChild(genBtn);
  dialog.appendChild(btnRow);

  overlay.appendChild(dialog);

  // Prevent keyboard events from leaking to the game/sheet viewer
  overlay.addEventListener('keydown', (e) => e.stopPropagation());
  overlay.addEventListener('keyup', (e) => e.stopPropagation());

  // Close on overlay click (outside dialog)
  overlay.onclick = (e) => {
    if (e.target === overlay) callbacks.onCancel();
  };

  return overlay;
}

// ---------------------------------------------------------------------------
// Progress update helper
// ---------------------------------------------------------------------------

export function updatePixelLabProgress(
  modal: HTMLElement,
  progress: number,
  text: string,
): void {
  const fill = modal.querySelector('.pixellab-progress-fill') as HTMLElement | null;
  const label = modal.querySelector('.pixellab-progress-text') as HTMLElement | null;
  if (fill) fill.style.width = `${Math.round(progress * 100)}%`;
  if (label) label.textContent = text;
}
