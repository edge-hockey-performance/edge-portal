// Replacement outputs deliberately do not contain their source anchors:
// the existing streaming injector may process its retained tail more than once.
export const BLADE_SIZES_MM = [210, 220, 230, 238, 246, 254, 263, 272, 280, 288, 296, 306, 312] as const;

const sizeField = (id: string) => `<div class="field">
  <label for="${id}">Blade Size (mm) <span style="color:var(--dim);font-weight:400;">(optional)</span></label>
  <select id="${id}">
    <option value="">Not specified</option>
    ${BLADE_SIZES_MM.map(size => `<option value="${size}">${size} mm</option>`).join('')}
  </select>
</div>`;

export function getBladeSizeReplacements(): ReadonlyArray<readonly [string, string]> {
  return [
    ['<div class="field-row">\n                <div class="field">\n                  <label>Current Steel Install Date</label>',
     sizeField('edit-blade-size') + '\n<div class="field-row" data-blade-size-adjacent>\n                <div class="field">\n                  <label>Current Steel Install Date</label>'],
    ['<div class="field-row">\n                <div class="field">\n                  <label>Install Date</label>',
     sizeField('aed-blade-size') + '\n<div class="field-row" data-blade-size-adjacent>\n                <div class="field">\n                  <label>Install Date</label>'],
    ["if (smEl)  smEl.value  = currentProfile.steel_model  || '';",
     "if (smEl) smEl.value = currentProfile.steel_model || '';\n  document.getElementById('edit-blade-size').value = currentProfile.blade_size_mm == null ? '' : String(currentProfile.blade_size_mm);"],
    ["if (steel_model)           updates.steel_model         = steel_model;",
     "if (steel_model) updates.steel_model = steel_model;\n  const bladeSize = document.getElementById('edit-blade-size').value;\n  updates.blade_size_mm = bladeSize === '' ? null : Number(bladeSize);"],
    ["setVal('aed-steel-model', p.steel_model);",
     "setVal( 'aed-steel-model', p.steel_model);\n  setVal('aed-blade-size', p.blade_size_mm);"],
    ["steel_model:             getStr('aed-steel-model'),",
     "steel_model: getStr('aed-steel-model'),\n    blade_size_mm:           getInt('aed-blade-size'),"],
    ["if (currentProfile.profile_preference) profileRows.push(['Profile Pref', currentProfile.profile_preference]);",
     "profileRows.push(['Blade Size', currentProfile.blade_size_mm == null ? 'Not specified' : currentProfile.blade_size_mm + ' mm']);\n    if (currentProfile.profile_preference) { profileRows.push(['Profile Pref', currentProfile.profile_preference]); }"],
  ];
}
