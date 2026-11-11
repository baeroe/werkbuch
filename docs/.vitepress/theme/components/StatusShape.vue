<script setup lang="ts">
/** A status of the app: colour is the category, shape the status (DESIGN.md). Decorative next to the status text. */
defineProps<{ shape: 'circle' | 'half' | 'check' }>();
</script>

<template>
    <svg class="wb-status" :class="`is-${shape}`" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <template v-if="shape === 'check'">
            <circle cx="12" cy="12" r="10" fill="currentColor" />
            <path d="m16 9-5.5 5.5L8 12" class="knock" />
        </template>
        <template v-else>
            <circle cx="12" cy="12" r="10" />
            <path v-if="shape === 'half'" d="M12 18a6 6 0 0 0 0-12v12z" fill="currentColor" />
        </template>
    </svg>
</template>
