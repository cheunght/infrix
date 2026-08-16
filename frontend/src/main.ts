import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import App from './App.vue'
import './style.css'
import './feature-styles.css'
import './rack-view.css'
import './element-admin.css'

createApp(App).use(ElementPlus, { locale: zhCn }).mount('#app')
