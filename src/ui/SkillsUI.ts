import { getSkill, MAX_SKILL_LEVEL, PERK_LEVELS, PERKS, SKILLS, type PerkId, type Skills } from '../systems/Skills';

/**
 * Fertigkeiten (Taste K): Stufe, Fortschritt zur nächsten Stufe und aktuelle Wirkung – dazu je Fertigkeit
 * zwei Talentstufen (ab Stufe 3 und 7), auf denen man sich für eines von zwei Talenten entscheidet.
 */
export class SkillsUI {
  private _open = false;
  /** Klick auf ein wählbares Talent. */
  onChoose: ((id: PerkId) => void) | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly skills: Skills,
  ) {}

  get open(): boolean {
    return this._open;
  }

  show(): void {
    this._open = true;
    this.root.classList.remove('hidden');
    this.render();
  }

  hide(): void {
    this._open = false;
    this.root.classList.add('hidden');
  }

  render(): void {
    const list = this.root.querySelector<HTMLElement>('[data-ref="skillList"]')!;
    const summary = this.root.querySelector<HTMLElement>('[data-ref="skillSummary"]');
    const open = this.skills.openChoices;
    if (summary) summary.textContent = open > 0 ? `${open} ${open === 1 ? 'Talent wartet' : 'Talente warten'} auf deine Wahl.` : 'Was du oft tust, kannst du bald besser.';
    list.replaceChildren();
    for (const s of SKILLS) {
      const level = this.skills.level(s.id);
      const row = document.createElement('div');
      row.className = 'skill';
      const head = document.createElement('div');
      head.className = 'skill__head';
      const name = document.createElement('span');
      name.textContent = getSkill(s.id).name;
      const lv = document.createElement('span');
      lv.className = 'skill__level';
      lv.textContent = level >= MAX_SKILL_LEVEL ? 'Meister' : `Stufe ${level}`;
      head.append(name, lv);
      const bar = document.createElement('div');
      bar.className = 'skill__bar';
      const fill = document.createElement('div');
      fill.style.width = `${Math.round(this.skills.progress(s.id) * 100)}%`;
      bar.append(fill);
      const info = document.createElement('div');
      info.className = 'skill__info';
      info.textContent = `${level > 0 ? s.effect(level) : 'Noch keine Wirkung'} · steigt durch: ${s.how}`;
      row.append(head, bar, info);
      for (const tier of [0, 1] as const) {
        const tierEl = document.createElement('div');
        tierEl.className = 'perks';
        const label = document.createElement('span');
        label.className = 'perks__label';
        label.textContent = `Ab ${PERK_LEVELS[tier]}`;
        tierEl.append(label);
        const chosen = this.skills.chosen(s.id, tier);
        for (const p of PERKS.filter((x) => x.skill === s.id && x.tier === tier)) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'perk';
          const available = this.skills.canChoose(p.id);
          if (chosen === p.id) btn.classList.add('is-chosen');
          else if (chosen) btn.classList.add('is-passed');
          else if (available) btn.classList.add('is-available');
          else btn.classList.add('is-locked');
          btn.disabled = !available;
          const title = document.createElement('strong');
          title.textContent = p.name;
          const text = document.createElement('span');
          text.textContent = p.text;
          btn.append(title, text);
          btn.addEventListener('click', () => this.onChoose?.(p.id));
          tierEl.append(btn);
        }
        row.append(tierEl);
      }
      list.append(row);
    }
  }
}
