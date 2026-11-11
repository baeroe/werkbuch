<script setup lang="ts">
/** The way onto a server: three steps (a real sequence, so numbered) and the one command, to copy. */
import { computed, ref } from 'vue';
import { useData, withBase } from 'vitepress';
import { copy, type Lang } from './copy';

const { lang } = useData();
const l = computed<Lang>(() => (lang.value.startsWith('de') ? 'de' : 'en'));
const t = computed(() => copy[l.value].host);
const copied = ref(false);

async function copyCommand() {
    try {
        await navigator.clipboard.writeText(t.value.command);
        copied.value = true;
        window.setTimeout(() => (copied.value = false), 1800);
    } catch {
        // without the clipboard the command stays selectable on the page
    }
}
</script>

<template>
    <section class="wb-host" aria-labelledby="wb-host-title">
        <div class="intro">
            <h2 id="wb-host-title">{{ t.heading }}</h2>
            <p>{{ t.lead }}</p>
        </div>
        <ol class="steps">
            <li v-for="(step, i) in t.steps" :key="step.title" class="step">
                <span class="num" aria-hidden="true">{{ i + 1 }}</span>
                <h3>{{ step.title }}</h3>
                <p>{{ step.text }}</p>
            </li>
        </ol>
        <div class="command">
            <code><span class="prompt" aria-hidden="true">$</span>{{ t.command }}</code>
            <button type="button" class="copy" @click="copyCommand">
                <span aria-live="polite">{{ copied ? t.copied : t.copy }}</span>
            </button>
            <a class="setup" :href="withBase(`/${l}/setup`)">{{ t.more }}</a>
        </div>
    </section>
</template>
