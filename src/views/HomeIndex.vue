<template>
  <div>
    <h1>Hello Vue 3!</h1>
  </div>
</template>

<script lang="ts" setup>
import { ref, reactive, defineOptions } from 'vue';
defineOptions({ name: 'HomeIndex' });

const a = ref(1);
const b = reactive({ count: 0 });
console.log(a.value, b.count);
</script>

<style scoped></style>
