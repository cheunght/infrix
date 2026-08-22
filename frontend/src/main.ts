import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import App from './App.vue'
import { router } from './router'
import './style.css'
import './feature-styles.css'
import './rack-view.css'
import './element-admin.css'
import './components/page/page-layout.css'
import './settings-styles.css'

const app = createApp(App)
app.use(router).use(ElementPlus, { locale: zhCn })
router.isReady().then(() => app.mount('#app'))
