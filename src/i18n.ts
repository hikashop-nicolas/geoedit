// Self-contained i18n for geoedit so the library is a complete multilingual product on
// its own. Detects the locale from the browser preferred-languages list (base language,
// first match), English fallback. Adding a language = add a dict to LOCALES; hosts may
// force one via setLocale().

type Dict = Record<string, string>;

const en: Dict = {
  undo: "Undo (Ctrl+Z)",
  redo: "Redo (Ctrl+Shift+Z)",
  addPoint: "Add point",
  addLine: "Add line",
  addArea: "Add area",
  toggleLabels: "Toggle labels",
  featureList: "Feature list",
  exportAs: "Export as",
  features: "Features",
  filterFeatures: "Filter features…",
  close: "Close",
  feature: "Feature",
  noProperties: "No properties.",
  noFeatures: "No features.",
  editShape: "Edit shape",
  deleteFeature: "Delete feature",
  dragToReshape: "Drag the handles to reshape",
  done: "Done",
  cancel: "Cancel",
  add: "Add",
  colour: "color",
  removeProperty: "Remove property",
  addProperty: "Add property",
  newProperty: "new property",
  value: "value",
  readonlyNotFc: "Read-only (not a FeatureCollection).",
  readonlyUnmatched: "This feature could not be matched to the source; read-only.",
  geomPoint: "point",
  geomLine: "line",
  geomArea: "area",
  geomFeature: "feature",
  newThing: "New {thing}",
  errRead: "This file could not be read as a map:",
  errDisplay: "The map could not be displayed:",
  errExport: "Could not export",
  errDraw: "Could not start drawing",
  errEditShape: "Could not edit shape",
  errSaveShape: "Could not save shape",
  errDelProp: "Could not delete property",
  errAddFeat: "Could not add feature",
  errDelFeat: "Could not delete feature",
  errUpdateProp: "Could not update property",
  geomUnsupported: "This geometry is not supported by {kind}.",
};

const fr: Dict = {
  undo: "Annuler (Ctrl+Z)",
  redo: "Rétablir (Ctrl+Maj+Z)",
  addPoint: "Ajouter un point",
  addLine: "Ajouter une ligne",
  addArea: "Ajouter une zone",
  toggleLabels: "Afficher les étiquettes",
  featureList: "Liste des entités",
  exportAs: "Exporter en",
  features: "Entités",
  filterFeatures: "Filtrer les entités…",
  close: "Fermer",
  feature: "Entité",
  noProperties: "Aucune propriété.",
  noFeatures: "Aucune entité.",
  editShape: "Modifier la forme",
  deleteFeature: "Supprimer l'entité",
  dragToReshape: "Déplacez les poignées pour remodeler",
  done: "Terminé",
  cancel: "Annuler",
  add: "Ajouter",
  colour: "couleur",
  removeProperty: "Supprimer la propriété",
  addProperty: "Ajouter une propriété",
  newProperty: "nouvelle propriété",
  value: "valeur",
  readonlyNotFc: "Lecture seule (pas une FeatureCollection).",
  readonlyUnmatched: "Cette entité n'a pas pu être associée à la source ; lecture seule.",
  geomPoint: "point",
  geomLine: "ligne",
  geomArea: "zone",
  geomFeature: "entité",
  newThing: "Nouveau {thing}",
  errRead: "Ce fichier n'a pas pu être lu comme une carte :",
  errDisplay: "La carte n'a pas pu être affichée :",
  errExport: "Échec de l'export",
  errDraw: "Impossible de démarrer le dessin",
  errEditShape: "Impossible de modifier la forme",
  errSaveShape: "Impossible d'enregistrer la forme",
  errDelProp: "Impossible de supprimer la propriété",
  errAddFeat: "Impossible d'ajouter l'entité",
  errDelFeat: "Impossible de supprimer l'entité",
  errUpdateProp: "Impossible de mettre à jour la propriété",
  geomUnsupported: "Cette géométrie n'est pas prise en charge par {kind}.",
};

const ja: Dict = {
  undo: "元に戻す (Ctrl+Z)",
  redo: "やり直し (Ctrl+Shift+Z)",
  addPoint: "点を追加",
  addLine: "線を追加",
  addArea: "面を追加",
  toggleLabels: "ラベルの表示切替",
  featureList: "地物一覧",
  exportAs: "エクスポート形式",
  features: "地物",
  filterFeatures: "地物を絞り込み…",
  close: "閉じる",
  feature: "地物",
  noProperties: "プロパティはありません。",
  noFeatures: "地物はありません。",
  editShape: "形状を編集",
  deleteFeature: "地物を削除",
  dragToReshape: "ハンドルをドラッグして形状を変更",
  done: "完了",
  cancel: "キャンセル",
  add: "追加",
  colour: "色",
  removeProperty: "プロパティを削除",
  addProperty: "プロパティを追加",
  newProperty: "新しいプロパティ",
  value: "値",
  readonlyNotFc: "読み取り専用（FeatureCollection ではありません）。",
  readonlyUnmatched: "この地物をソースと対応付けできませんでした。読み取り専用です。",
  geomPoint: "点",
  geomLine: "線",
  geomArea: "面",
  geomFeature: "地物",
  newThing: "新しい{thing}",
  errRead: "このファイルを地図として読み込めませんでした：",
  errDisplay: "地図を表示できませんでした：",
  errExport: "エクスポートできませんでした",
  errDraw: "描画を開始できませんでした",
  errEditShape: "形状を編集できませんでした",
  errSaveShape: "形状を保存できませんでした",
  errDelProp: "プロパティを削除できませんでした",
  errAddFeat: "地物を追加できませんでした",
  errDelFeat: "地物を削除できませんでした",
  errUpdateProp: "プロパティを更新できませんでした",
  geomUnsupported: "このジオメトリは {kind} ではサポートされていません。",
};

const LOCALES: Record<string, Dict> = { en, fr, ja };

let active: Dict | null = null;

function detect(): Dict {
  const prefs = (typeof navigator !== "undefined" && navigator.languages) || ["en"];
  for (const tag of prefs) {
    const base = tag.toLowerCase().split("-")[0]!;
    if (LOCALES[base]) return LOCALES[base]!;
  }
  return en;
}

/** Force a locale (host escape hatch). Unknown codes fall back to English. */
export function setLocale(code: string): void {
  const base = code.toLowerCase().split("-")[0]!;
  active = LOCALES[base] ?? en;
}

export function t(key: string, params?: Record<string, string | number>): string {
  if (!active) active = detect();
  let s = active[key] ?? en[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`));
  return s;
}
