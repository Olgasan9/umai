import {
    arrayFilter,
    arraySorted,
    compare,
    downloadFile,
    stringToSlug,
    urlParse,
    urlResolve,
} from '@noeldemartin/utils';
import { SolidDocument } from 'soukai-solid';
import type { JsonLD, SolidDocumentPermission } from '@noeldemartin/solid-utils';
import type { Relation } from 'soukai';
import type { RouteLocationRaw } from 'vue-router';
import type { SolidBelongsToManyRelation } from 'soukai-solid';

import Cookbook from '@/services/facades/Cookbook';
import RecipeInstructionsStep from '@/models/RecipeInstructionsStep';
import RecipesList from '@/models/RecipesList';
import { parseIngredient, sortIngredients } from '@/utils/ingredients';
import type { IngredientBreakdown } from '@/utils/ingredients';

import Model from './Recipe.schema';

export interface RecipeServingsBreakdown {
    original: string;
    quantity?: number;

    renderQuantity(quantity: number): string;
}

export type RecipeExportOptions = {
    includeIds: boolean;
    includeHistory: boolean;
};

export default class Recipe extends Model {

    declare public instructions?: RecipeInstructionsStep[];
    declare public relatedInstructions: SolidBelongsToManyRelation<
        this,
        RecipeInstructionsStep,
        typeof RecipeInstructionsStep
    >;

    declare public lists?: RecipesList[];
    declare public relatedLists: SolidBelongsToManyRelation<
        this,
        RecipesList,
        typeof RecipesList
    >;

    public get imageUrl(): string | undefined {
        return this.imageUrls.length > 0 ? this.imageUrls[0] : undefined;
    }

    public get slug(): string | null {
        if (!this.url) {
            return null;
        }

        const getSlug = (offset: number) => {
            return this.url.substring(offset).replaceAll('/', '-').match(/([^#]+)(#.*)?$/)?.[1] ?? null;
        };

        if (Cookbook.remoteCookbookUrl && this.url.startsWith(Cookbook.remoteCookbookUrl)) {
            return getSlug(Cookbook.remoteCookbookUrl.length);
        }

        if (this.url.startsWith(Cookbook.localCookbookUrl)) {
            return getSlug(Cookbook.localCookbookUrl.length);
        }

        return null;
    }

    public get sortedExternalUrls(): string[] {
        const externalUrls = this.externalUrls.map(url => ({
            url,
            domain: urlParse(url)?.domain?.replace(/^www\./, ''),
        }));

        return arraySorted(externalUrls, (a, b) => compare(a.domain, b.domain)).map(({ url }) => url);
    }

    public get sortedIngredients(): string[] {
        return this.sortedIngredientsBreakdown.map(({ original }) => original);
    }

    public get sortedIngredientsBreakdown(): IngredientBreakdown[] {
        const ingredients = this.ingredients.map(parseIngredient);

        sortIngredients(ingredients);

        return ingredients;
    }

    public get servingsBreakdown(): RecipeServingsBreakdown | null {
        const original = this.servings;
        const [quantityMatch] = original?.match(/\d+/) ?? [];

        if (!original || !quantityMatch) {
            return null;
        }

        return {
            original,
            quantity: parseInt(quantityMatch),
            renderQuantity: quantity => original.replace(quantityMatch, quantity.toString()),
        };
    }

    public get sortedInstructions(): RecipeInstructionsStep[] {
        return arraySorted(this.instructions ?? [], 'position');
    }

    public get autoLinks(): string[] {
        return arrayFilter([
            this.url,
            this.getDocumentUrl(),
            ...this.externalUrls,
        ]);
    }

    public route(type: string = 'show'): RouteLocationRaw {
        if (type === 'viewer') {
            return { name: 'viewer', query: { url: this.url } };
        }

        return { name: `recipes.${type}`, params: { recipe: this.slug } };
    }

    public is(other: Recipe): boolean {
        return this.url === other.url
            || this.externalUrls.some(url => url === other.url);
    }

    public instructionsRelationship(): Relation {
        return this
            .belongsToMany(RecipeInstructionsStep, 'instructionStepUrls')
            .onDelete('cascade')
            .usingSameDocument(true);
    }

    public listsRelationship(): Relation {
        return this.belongsToMany(RecipesList, 'listUrls');
    }

    public toExternalJsonLD(options: Partial<RecipeExportOptions> = {}): JsonLD {
        return this.toJsonLD({
            ids: options.includeIds ?? this.url?.startsWith('http'),
            timestamps: options.includeHistory ?? false,
            history: options.includeHistory ?? false,
        });
    }

    public download(options: Partial<RecipeExportOptions> = {}): void {
        const name = this.slug ?? 'recipe';
        const jsonld = this.toExternalJsonLD(options);

        downloadFile(`${name}.json`, JSON.stringify(jsonld), 'application/json');
    }

    public async updatePublicPermissions(permissions: SolidDocumentPermission[]): Promise<void> {
        await super.updatePublicPermissions(permissions);

        if (!this.imageUrl?.startsWith(this.requireContainerUrl())) {
            return;
        }

        await new SolidDocument({ url: this.imageUrl }).updatePublicPermissions(permissions);
    }

    protected newUrl(documentUrl?: string, resourceHash?: string): string {
        documentUrl = documentUrl ?? urlResolve(this.static('collection'), stringToSlug(this.name));
        resourceHash = resourceHash ?? this.static('defaultResourceHash');

        return `${documentUrl}#${resourceHash}`;
    }

}
