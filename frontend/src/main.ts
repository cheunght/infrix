import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
import { router } from './router'
import { i18n } from './i18n'
import './style.css'
import './feature-styles.css'
import './rack-view.css'
import './element-admin.css'
import './components/page/page-layout.css'
import './settings-styles.css'

const app = createApp(App)
app.use(router).use(i18n).use(ElementPlus)
router.isReady().then(() => app.mount('#app'))
