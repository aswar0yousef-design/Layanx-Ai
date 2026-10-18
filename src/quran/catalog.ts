export type QuranSourceLicenseStatus = "granted" | "restricted" | "unknown";

export interface QuranAuxiliarySource {
  id: string;
  kind: "timing" | "metadata" | "text" | "audio";
  name: string;
  repository: string;
  license: string;
  licenseUrl: string;
  status: QuranSourceLicenseStatus;
  commercialUse: boolean;
  redistributionOfSourceWork: boolean;
  audioRightsSeparate: boolean;
  attribution: string;
  notes: string;
}

export const QURAN_AUXILIARY_SOURCES: readonly QuranAuxiliarySource[] = [
  {
    id: "qud-universal-audio",
    kind: "timing",
    name: "Qur'anic Universal Audio",
    repository: "QUD-Technologies/quranic-universal-audio",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    status: "granted",
    commercialUse: true,
    redistributionOfSourceWork: true,
    audioRightsSeparate: true,
    attribution: "Qur'anic Universal Audio (QUD-Technologies), CC BY 4.0",
    notes: "Project-owned timestamps, segmentation, alignment and catalog metadata are CC BY 4.0. The repository explicitly says recitation recordings remain the property of reciters/upstream sources.",
  },
  {
    id: "quran-align",
    kind: "timing",
    name: "quran-align",
    repository: "cpfair/quran-align",
    license: "MIT (code); CC BY 4.0 (generated timing data)",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    status: "granted",
    commercialUse: true,
    redistributionOfSourceWork: true,
    audioRightsSeparate: true,
    attribution: "quran-align by Collin Fair; timing data CC BY 4.0",
    notes: "Useful as a fallback timing dataset. The timing files are licensed separately from the input recordings used to create them.",
  },
  {
    id: "mushaf-learning-quran-audio",
    kind: "metadata",
    name: "Quran Audio",
    repository: "Mushaf-Learning/quran-audio",
    license: "MIT",
    licenseUrl: "https://github.com/Mushaf-Learning/quran-audio/blob/main/LICENSE",
    status: "granted",
    commercialUse: true,
    redistributionOfSourceWork: true,
    audioRightsSeparate: true,
    attribution: "Mushaf-Learning/quran-audio",
    notes: "The repository provides metadata, URL mappings and timestamps; it states that the hosted audio remains at EveryAyah and is not contained in the repository. This entry does not grant rights to the hosted recordings.",
  },
  {
    id: "quran-json",
    kind: "metadata",
    name: "Quran JSON",
    repository: "risan/quran-json",
    license: "CC BY-SA 4.0 for project dataset; per-source terms apply",
    licenseUrl: "https://github.com/risan/quran-json/blob/main/LICENSE.txt",
    status: "granted",
    commercialUse: true,
    redistributionOfSourceWork: true,
    audioRightsSeparate: true,
    attribution: "Quran JSON by Risan; preserve each upstream source attribution/license",
    notes: "Useful as a provenance/licensing model. Its own documentation treats EveryAyah and MP3Quran audio as unknown-license links and Islamic Network as non-commercial; LayanX must not infer recording rights from this dataset.",
  },
] as const;

export function getQuranAuxiliarySource(id: string): QuranAuxiliarySource | undefined {
  return QURAN_AUXILIARY_SOURCES.find(source => source.id === id);
}

export function assertAuxiliarySourceUsable(id: string, kind: QuranAuxiliarySource["kind"]): QuranAuxiliarySource {
  const source = getQuranAuxiliarySource(id);
  if (!source) throw new Error("quran_auxiliary_source_unknown:" + id);
  if (source.kind !== kind) throw new Error("quran_auxiliary_source_kind_mismatch:" + id);
  if (source.status !== "granted" || !source.commercialUse || !source.redistributionOfSourceWork) {
    throw new Error("quran_auxiliary_source_not_commercially_usable:" + id);
  }
  return structuredClone(source);
}
