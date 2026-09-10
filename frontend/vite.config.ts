import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('/@element-plus/icons-vue/')) return 'element-icons'
          if (id.includes('/element-plus/es/components/table/')) return 'element-table'
          if (id.includes('/element-plus/es/components/pagination/')) return 'element-pagination'
          if (id.includes('/element-plus/')) return 'element-plus'
          if (id.includes('/vue/') || id.includes('/vue-router/') || id.includes('/vue-i18n/')) return 'vue'
          return undefined
        },
      },
    },
  },
})
