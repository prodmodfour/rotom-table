// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DamageClassBadge from '~/components/DamageClassBadge.vue'
import TypeBadge from '~/components/TypeBadge.vue'

describe('P13-062 original UI asset replacements', () => {
  it('renders a semantic project-authored type badge without an image dependency', () => {
    const wrapper = mount(TypeBadge, {
      props: { type: 'Fire', size: 'md' },
    })

    expect(wrapper.element.tagName).toBe('SPAN')
    expect(wrapper.attributes('data-type')).toBe('fire')
    expect(wrapper.attributes('aria-label')).toBe('Fire type')
    expect(wrapper.text()).toBe('FIFire')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.classes()).toContain('source-badge--md')
  })

  it('keeps decorative type badges out of the accessibility tree', () => {
    const wrapper = mount(TypeBadge, {
      props: { type: 'Water', decorative: true },
    })

    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(wrapper.attributes('aria-label')).toBeUndefined()
  })

  it('renders damage-class text and its full accessible label without an image', () => {
    const wrapper = mount(DamageClassBadge, {
      props: { category: 'Special', size: 'xs' },
    })

    expect(wrapper.attributes('data-category')).toBe('special')
    expect(wrapper.attributes('aria-label')).toBe('Special damage class')
    expect(wrapper.text()).toBe('SPSpecial')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.classes()).toContain('source-badge--xs')
  })
})
