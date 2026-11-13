import { describe, expect, it } from 'vitest';
import type { DocType } from '../api/types';
import { blankForm, bodyOf, conformance, formOf, formProblem, frontKeys, slug } from './doc-types';

const ADR: DocType = {
  key: 'adr',
  name: 'Architecture Decision Record',
  description: 'Why we chose',
  gts_type_id: 'gts.x',
  owner: 'builtin',
  body: '# <title>\n',
  sections: [
    { key: 'context', title: 'Context', required: true, min_words: 20, aliases: ['Background'] },
    { key: 'notes', title: 'Notes', required: false },
  ],
  rules: { warn_unknown_sections: true, front_matter: ['status', 'owner'], forbid_placeholders: false, min_title_words: 3 },
};

describe('doc-types form', () => {
  it('slugs a section title, with a fallback for one with no letters', () => {
    expect(slug('  Decision Drivers! ')).toBe('decision_drivers');
    expect(slug('***')).toBe('section');
  });

  it('reads a type into the form and back unchanged', () => {
    const form = formOf(ADR);
    expect(form.frontMatter).toBe('status, owner');
    expect(form.sections[1].minWords).toBe(0);
    expect(bodyOf(form)).toEqual({
      key: 'adr',
      name: 'Architecture Decision Record',
      description: 'Why we chose',
      body: '# <title>\n',
      sections: [
        { key: 'context', title: 'Context', required: true, min_words: 20, aliases: ['Background'] },
        { key: 'notes', title: 'Notes', required: false, min_words: null, aliases: null },
      ],
      rules: { warn_unknown_sections: true, front_matter: ['status', 'owner'], forbid_placeholders: false, min_title_words: 3 },
    });
  });

  it('drops untitled sections and trims what is saved', () => {
    const form = { ...blankForm(), key: ' spec ', name: ' Spec ', frontMatter: ' a, ,b ' };
    form.sections = [...form.sections, { title: '  ', required: true, minWords: 5 }];
    const body = bodyOf(form);
    expect(body.key).toBe('spec');
    expect(body.name).toBe('Spec');
    expect(body.sections).toHaveLength(1);
    expect(body.rules?.front_matter).toEqual(['a', 'b']);
  });

  it('needs a key and a name', () => {
    expect(formProblem(blankForm())).toBe('key_and_name');
    expect(formProblem({ ...blankForm(), key: 'k', name: 'N' })).toBeNull();
  });

  it('says when a document conforms', () => {
    expect(conformance(formOf(ADR))).toEqual({
      required: 1,
      defined: 2,
      minWords: true,
      frontMatter: ['status', 'owner'],
      minTitle: 3,
      forbid: false,
      warn: true,
    });
    expect(frontKeys('')).toEqual([]);
  });
});
