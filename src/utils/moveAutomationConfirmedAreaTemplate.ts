import { moveAutomationAreaTemplateId } from '~/utils/moveAutomationAreaTemplates'
import type { MoveAutomationAreaTemplate, MoveAutomationScript } from '~/types/moveAutomation'

const cloneAreaTemplate = (template: MoveAutomationAreaTemplate): MoveAutomationAreaTemplate => ({ ...template })

const uniqueAreaTemplateOptions = (
  templates: readonly MoveAutomationAreaTemplate[] | null | undefined,
): MoveAutomationAreaTemplate[] => {
  const options: MoveAutomationAreaTemplate[] = []
  const seen = new Set<string>()
  for (const template of templates ?? []) {
    const id = moveAutomationAreaTemplateId(template)
    if (seen.has(id)) continue
    seen.add(id)
    options.push(template)
  }
  return options
}

const uniqueLabels = (labels: readonly string[]): string[] => {
  const out: string[] = []
  const seen = new Set<string>()
  for (const label of labels) {
    const normalized = label.toLocaleLowerCase()
    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(label)
  }
  return out
}

const keywordContainsAreaTemplateLabel = (
  keyword: string,
  templateLabels: readonly string[],
): boolean => {
  const normalizedKeyword = keyword.toLocaleLowerCase()
  return templateLabels.some((label) => normalizedKeyword.includes(label.toLocaleLowerCase()))
}

const confirmedAreaScriptKeywords = (
  script: MoveAutomationScript,
  selectedTemplate: MoveAutomationAreaTemplate,
  templateLabels: readonly string[],
): string[] => {
  const selectedLabel = selectedTemplate.label.toLocaleLowerCase()
  return [
    selectedTemplate.label,
    ...script.keywords.filter((keyword) => (
      keyword.toLocaleLowerCase() !== selectedLabel
      && !keywordContainsAreaTemplateLabel(keyword, templateLabels)
    )),
  ]
}

export interface MoveAutomationConfirmedAreaTemplateOptions {
  readonly alternativeTemplateLabels?: readonly string[]
}

export const moveAutomationScriptForConfirmedAreaTemplate = (
  script: MoveAutomationScript,
  selectedTemplate: MoveAutomationAreaTemplate,
  options: MoveAutomationConfirmedAreaTemplateOptions = {},
): MoveAutomationScript => {
  const template = cloneAreaTemplate(selectedTemplate)
  const templateLabels = options.alternativeTemplateLabels
    ? uniqueLabels([...options.alternativeTemplateLabels])
    : uniqueAreaTemplateOptions(script.areaTemplates).map((item) => item.label)
  if (templateLabels.length <= 1) {
    return {
      ...script,
      keywords: [...script.keywords],
      areaTemplates: [template],
    }
  }

  const keywords = confirmedAreaScriptKeywords(script, selectedTemplate, templateLabels)
  return {
    ...script,
    range: keywords.join(', '),
    keywords,
    areaTemplates: [template],
  }
}
