<template>
    <AppModal>
        <template #title>
            <div class="flex justify-between">
                {{ $t('recipes.share') }}
                <RecipeAccessControl v-if="$cookbook.isRemote" :recipe="recipe" />
            </div>
        </template>

        <template #default="{ close }">
            <RecipeShareOptions v-model="shareOption" />
            <CoreClipboard class="mt-4 max-w-prose" :text="clipboardContent" />
            <p v-if="warning" class="text-red-500 flex self-start mt-2 max-w-prose">
                <i-zondicons-exclamation-outline class="w-4 h-4 mt-1 mr-2 flex-shrink-0" />
                {{ warning }}
            </p>
            <div class="flex justify-between mt-4">
                <label v-if="shareOption === 'jsonld'" class="cursor-pointer flex items-center">
                    <BaseCheckbox v-model="includeHistory" />
                    <p class="ml-2">{{ $t('recipes.download_includeHistory') }}</p>
                </label>
                <span v-else />
                <CoreButton
                    v-if="shareOption === 'jsonld'"
                    v-initial-focus
                    @click="() => (recipe.download({ includeHistory }), close())"
                >
                    <i-pepicons-cloud-down class="w-6 h-6" aria-hidden="true" />
                    <span class="ml-2">{{ $t('recipes.download') }}</span>
                </CoreButton>
                <CoreButton
                    v-else-if="$browser.supportsSharing"
                    v-initial-focus
                    @click="share(), close()"
                >
                    <i-pepicons-share-android class="w-6 h-6" aria-hidden="true" />
                    <span class="ml-2">{{ $t('recipes.share') }}</span>
                </CoreButton>
            </div>
        </template>
    </AppModal>
</template>

<script setup lang="ts">
import { objectWithoutEmpty, stringExcerpt, urlRoot } from '@noeldemartin/utils';

import Router from '@/framework/core/facades/Router';
import { requiredObjectProp } from '@/framework/utils/vue';
import { translate } from '@/framework/utils/translate';

import Cookbook from '@/services/facades/Cookbook';
import { RecipeShareOption } from '@/components/recipe/RecipeShareOptions';
import type Recipe from '@/models/Recipe';

const { recipe } = defineProps({
    recipe: requiredObjectProp<Recipe>(),
});

const includeHistory = $ref(false);
const shareOption = $ref<RecipeShareOption>(Cookbook.isRemote ? RecipeShareOption.Umai : RecipeShareOption.JsonLD);
const clipboardContents: Record<RecipeShareOption, string> = $computed(() => ({
    [RecipeShareOption.Umai]:
        urlRoot(location.href) +
        Router.resolve({ name: 'viewer', query: { url: recipe.getDocumentUrl() } }).href,
    [RecipeShareOption.Solid]: recipe.url,
    [RecipeShareOption.JsonLD]: JSON.stringify(recipe.toExternalJsonLD({ includeHistory }), null, 2),
}));
const clipboardContent = $computed(() => (clipboardContents as Record<string, string>)[shareOption]);
const warning = $computed(() => {
    if (shareOption !== RecipeShareOption.Umai || recipe.isPrivate === false) {
        return;
    }

    return recipe.isPrivate
        ? translate('recipes.accessControl.warning_private')
        : translate('recipes.accessControl.warning_unknown');
});

function share() {
    navigator.share(objectWithoutEmpty({
        title: recipe.name,
        text: recipe.description ? stringExcerpt(recipe.description) : null,
        url: clipboardContent,
    }));
}
</script>
