import { getSkill, MAX_SKILL_LEVEL, SKILLS, type Skills } from '../systems/Skills';

/** Fertigkeiten (Taste K): Stufe, Fortschritt zur nächsten Stufe und aktuelle Wirkung. */
export class SkillsUI {
  private _open = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly skills: Skills,
  ) {}

  get open(): boolean {
    return this._open;
  }

  toggle(): void {
    this._open = !this._open;
    this.root.classList.toggle('hidden', !this._open);
    if (this._open) this.render();
  }

  hide(): void {
    this._open = false;
    this.root.classList.add('hidden');
  }

  render(): void {
    const list = this.root.querySelector<HTMLElement>('[data-ref="skillList"]')!;
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
      list.append(row);
    }
  }
}
