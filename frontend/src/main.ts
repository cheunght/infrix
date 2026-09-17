import { createApp } from 'vue'
import 'element-plus/dist/index.css'
import App from './App.vue'
import { router } from './router'
import { currentLocale, i18n, loadLocaleMessages } from './i18n'
import { registerShellElementComponents } from './element-plus-components'
import './style.css'
import './feature-styles.css'
import './rack-view.css'
import './element-admin.css'
import './components/page/page-layout.css'
import './settings-styles.css'

const app = createApp(App)
app.use(router).use(i18n)
registerShellElementComponents(app)
Promise.all([
  router.isReady(),
  loadLocaleMessages(currentLocale.value).catch(() => undefined),
]).then(() => app.mount('#app'))
