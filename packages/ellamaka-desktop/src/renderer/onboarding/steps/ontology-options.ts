export interface OntologySourceOption {
  id: string
  name: string
  description: string
  advanced: boolean
}

export interface OntologyModeOption {
  id: "fork" | "clone"
  name: string
  summary: string
  recommended: boolean
  requiresGithubAuth: boolean
}

export const ONTOLOGY_SOURCES: readonly OntologySourceOption[] = [
  {
    id: "official",
    name: "WopalSpace 官方能力本体",
    description: "由官方持续维护，适合绝大多数用户。",
    advanced: false,
  },
  {
    id: "custom",
    name: "定制能力本体",
    description: "使用社区用户优化后的能力本体。",
    advanced: true,
  },
]

export const ONTOLOGY_MODES: readonly OntologyModeOption[] = [
  {
    id: "fork",
    name: "Fork",
    summary: "可持续优化并贡献能力进化",
    recommended: true,
    requiresGithubAuth: true,
  },
  {
    id: "clone",
    name: "Clone",
    summary: "仅限当前电脑本地使用",
    recommended: false,
    requiresGithubAuth: false,
  },
]
