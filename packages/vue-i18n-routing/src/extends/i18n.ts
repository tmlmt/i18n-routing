import { isBoolean, isObject } from '@intlify/shared'
import { ref, computed, isVue3, effectScope, isVue2 } from 'vue-demi'

import {
  localePath,
  localeRoute,
  localeLocation,
  switchLocalePath,
  getRouteBaseName,
  resolveRoute,
  localeHead
} from '../compatibles'
import { DEFAULT_BASE_URL } from '../constants'
import { resolveBaseUrl, isVueI18n, getComposer } from '../utils'

import type { I18nRoutingOptions, LocaleObject } from '../types'
import type { I18n, Composer, VueI18n } from '@intlify/vue-i18n-bridge'
import type { App } from 'vue-demi'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Vue = any

// eslint-disable-next-line @typescript-eslint/ban-types
export function proxyVueInstance(target: Function): Function {
  // `this` is the Vue instance
  return function (this: Vue) {
    return Reflect.apply(
      target,
      {
        getRouteBaseName: this.getRouteBaseName,
        localePath: this.localePath,
        localeRoute: this.localeRoute,
        localeLocation: this.localeLocation,
        resolveRoute: this.resolveRoute,
        switchLocalePath: this.switchLocalePath,
        localeHead: this.localeHead,
        i18n: this.$i18n,
        route: this.$route,
        router: this.$router
      },
      // eslint-disable-next-line prefer-rest-params
      arguments
    )
  }
}

/**
 * An options of Vue I18n Routing Plugin
 */
export interface VueI18nRoutingPluginOptions {
  /**
   * Whether to inject some option APIs style methods into Vue instance
   *
   * @defaultValue `true`
   */
  inject?: boolean
}

export interface ExtendProperyDescripters {
  [key: string]: Pick<PropertyDescriptor, 'get'>
}
export type ExtendComposerHook = (compser: Composer) => void
export type ExtendVueI18nHook = (composer: Composer) => ExtendProperyDescripters
export type ExtendExportedGlobalHook = (global: Composer) => ExtendProperyDescripters

export interface ExtendHooks {
  onExtendComposer?: ExtendComposerHook
  onExtendExportedGlobal?: ExtendExportedGlobalHook
  onExtendVueI18n?: ExtendVueI18nHook
}

export type VueI18nExtendOptions = Pick<I18nRoutingOptions, 'baseUrl'> & {
  locales?: string[] | LocaleObject[]
  localeCodes?: string[]
  hooks?: ExtendHooks
}

export function extendI18n<TI18n extends I18n>(
  i18n: TI18n,
  { locales = [], localeCodes = [], baseUrl = DEFAULT_BASE_URL, hooks = {} }: VueI18nExtendOptions = {}
) {
  const scope = effectScope()

  const orgInstall = i18n.install
  i18n.install = (vue: Vue, ...options: unknown[]) => {
    Reflect.apply(orgInstall, i18n, [vue, ...options])

    const composer = getComposer(i18n)

    // extend global
    scope.run(() => extendComposer(composer, { locales, localeCodes, baseUrl, hooks }))
    if (isVueI18n(i18n.global)) {
      extendVueI18n(i18n.global, hooks.onExtendVueI18n)
    }

    // extend vue component instance for Vue 3
    const app = vue as App
    // prettier-ignore
    const exported = i18n.mode === 'composition'
      ? isVue3
        ? app.config.globalProperties.$i18n
        : i18n
      : isVue2
        ? i18n
        : null
    if (exported) {
      extendExportedGlobal(exported, composer, hooks.onExtendExportedGlobal)
    }

    const pluginOptions = isPluginOptions(options[0]) ? options[0] : { inject: true }
    if (pluginOptions.inject) {
      // extend vue component instance
      vue.mixin({
        methods: {
          resolveRoute: proxyVueInstance(resolveRoute),
          localePath: proxyVueInstance(localePath),
          localeRoute: proxyVueInstance(localeRoute),
          localeLocation: proxyVueInstance(localeLocation),
          switchLocalePath: proxyVueInstance(switchLocalePath),
          getRouteBaseName: proxyVueInstance(getRouteBaseName),
          localeHead: proxyVueInstance(localeHead)
        }
      })
    }

    // release scope on unmounting
    if (app.unmount) {
      const unmountApp = app.unmount
      app.unmount = () => {
        scope.stop()
        unmountApp()
      }
    }
  }

  return scope
}

function extendComposer(composer: Composer, options: VueI18nExtendOptions) {
  const { locales, localeCodes, baseUrl } = options

  const _locales = ref<string[] | LocaleObject[]>(locales!)
  const _localeCodes = ref<string[]>(localeCodes!)

  composer.locales = computed(() => _locales.value)
  composer.localeCodes = computed(() => _localeCodes.value)
  composer.__baseUrl = resolveBaseUrl(baseUrl!, {})

  if (options.hooks && options.hooks.onExtendComposer) {
    options.hooks.onExtendComposer(composer)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extendExportedGlobal(exported: any, g: Composer, hook?: ExtendExportedGlobalHook) {
  const properties: ExtendProperyDescripters[] = [
    {
      locales: {
        get() {
          return g.locales.value
        }
      },
      localeCodes: {
        get() {
          return g.localeCodes.value
        }
      },
      __baseUrl: {
        get() {
          return g.__baseUrl
        }
      }
    }
  ]
  hook && properties.push(hook(g))
  for (const property of properties) {
    for (const [key, descriptor] of Object.entries(property)) {
      Object.defineProperty(exported, key, descriptor)
    }
  }
}

function extendVueI18n(vueI18n: VueI18n, hook?: ExtendVueI18nHook): void {
  const composer = getComposer(vueI18n)
  const properties: ExtendProperyDescripters[] = [
    {
      locales: {
        get() {
          return composer.locales.value
        }
      },
      localeCodes: {
        get() {
          return composer.localeCodes.value
        }
      },
      __baseUrl: {
        get() {
          return composer.__baseUrl
        }
      }
    }
  ]
  hook && properties.push(hook(composer))
  for (const property of properties) {
    for (const [key, descriptor] of Object.entries(property)) {
      Object.defineProperty(vueI18n, key, descriptor)
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isPluginOptions(options: any): options is VueI18nRoutingPluginOptions {
  return isObject(options) && 'inject' in options && isBoolean(options.inject)
}
