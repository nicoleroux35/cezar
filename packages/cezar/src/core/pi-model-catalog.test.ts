import { describe, expect, it } from 'vitest';
import { parsePiModelsOutput } from './pi-model-catalog.ts';

const SAMPLE = `provider          model                context  max-out  thinking  images
cc-switch-a6-api  deepseek-v4.1-flash  1.0M     384K     no        no    
cc-switch-nvidia  moonshotai/kimi-k3   1.0M     131.1K   yes       yes   
cc-switch-nvidia  z-ai/glm-5.3         1.0M     131.1K   yes       no    
`;

describe('parsePiModelsOutput', () => {
  it('parses the fixed-width table into provider/model ids', () => {
    expect(parsePiModelsOutput(SAMPLE)).toEqual([
      { id: 'cc-switch-a6-api/deepseek-v4.1-flash', label: 'deepseek-v4.1-flash', description: 'cc-switch-a6-api' },
      { id: 'cc-switch-nvidia/moonshotai/kimi-k3', label: 'moonshotai/kimi-k3', description: 'cc-switch-nvidia' },
      { id: 'cc-switch-nvidia/z-ai/glm-5.3', label: 'z-ai/glm-5.3', description: 'cc-switch-nvidia' },
    ]);
  });

  it('is empty for a model-less host', () => {
    expect(parsePiModelsOutput('provider          model                context  max-out  thinking  images\n')).toEqual([]);
  });

  it('skips garbage and no-match lines rather than guessing an id', () => {
    expect(parsePiModelsOutput('pi: no models configured\n')).toEqual([]);
    expect(parsePiModelsOutput('No models matching "nonexistentxyz"\n')).toEqual([]);
  });
});
