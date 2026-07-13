import type { AssetItem, AssetLibrary, GenerationHistoryItem, GenerationRecipe, RecipePackage } from '../types';
import { addAsset } from './assetStorage';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export function createRecipePackageFromAsset(asset: AssetItem): RecipePackage {
  const recipe: GenerationRecipe = {
    prompt: asset.prompt || asset.name || '',
    provider: asset.provider,
    model: asset.model,
    generationParams: asset.generationParams,
  };

  return {
    version: 1,
    asset: {
      name: asset.name,
      folderIds: [],
      tags: asset.tags ?? [],
      dataUrl: asset.dataUrl,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
    },
    recipe,
    createdAt: Date.now(),
  };
}

export function createAssetFromHistoryItem(item: GenerationHistoryItem): AssetItem {
  return {
    id: item.id,
    name: item.name || 'Generated',
    folderIds: [],
    tags: [],
    dataUrl: item.dataUrl,
    mimeType: item.mimeType,
    width: item.width,
    height: item.height,
    createdAt: item.createdAt,
    source: 'generation',
    prompt: item.prompt,
    provider: item.provider,
    model: item.model,
    generationParams: item.generationParams,
  };
}

export function installRecipePackageToAssets(
  library: AssetLibrary,
  pack: RecipePackage,
  now = Date.now(),
): AssetLibrary {
  const asset: AssetItem = {
    id: `recipe_asset_${now}`,
    name: pack.asset.name || 'Recipe Asset',
    folderIds: pack.asset.folderIds ?? [],
    tags: pack.asset.tags ?? [],
    dataUrl: pack.asset.dataUrl,
    mimeType: pack.asset.mimeType,
    width: pack.asset.width,
    height: pack.asset.height,
    createdAt: now,
    source: 'recipe',
    prompt: pack.recipe.prompt,
    provider: pack.recipe.provider,
    model: pack.recipe.model,
    generationParams: pack.recipe.generationParams,
  };

  return addAsset(library, asset);
}

export function serializeRecipePackage(pack: RecipePackage): string {
  return JSON.stringify(pack, null, 2);
}

export function parseRecipePackageJson(input: string): RecipePackage | null {
  try {
    const raw = JSON.parse(input) as unknown;
    if (!isRecord(raw) || raw.version !== 1) return null;
    if (!isRecord(raw.asset) || !isRecord(raw.recipe)) return null;

    if (typeof raw.asset.dataUrl !== 'string' || !raw.asset.dataUrl.trim()) return null;
    if (typeof raw.asset.mimeType !== 'string' || !raw.asset.mimeType.trim()) return null;
    if (!isPositiveNumber(raw.asset.width) || !isPositiveNumber(raw.asset.height)) return null;
    if (typeof raw.recipe.prompt !== 'string') return null;

    const folderIds = isStringArray(raw.asset.folderIds) ? raw.asset.folderIds : [];
    const tags = isStringArray(raw.asset.tags) ? raw.asset.tags : [];

    const recipe: GenerationRecipe = {
      prompt: raw.recipe.prompt,
      provider: typeof raw.recipe.provider === 'string' ? raw.recipe.provider : undefined,
      model: typeof raw.recipe.model === 'string' ? raw.recipe.model : undefined,
      generationParams: isRecord(raw.recipe.generationParams) ? raw.recipe.generationParams : undefined,
    };

    return {
      version: 1,
      asset: {
        name: typeof raw.asset.name === 'string' ? raw.asset.name : undefined,
        folderIds,
        tags,
        dataUrl: raw.asset.dataUrl,
        mimeType: raw.asset.mimeType,
        width: raw.asset.width,
        height: raw.asset.height,
      },
      recipe,
      createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
        ? raw.createdAt
        : Date.now(),
    };
  } catch {
    return null;
  }
}