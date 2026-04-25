import { tool } from 'ai';
import { z } from 'zod';
import { findSkill, loadSkills } from './loader.js';

export const loadSkillTool = tool({
  description:
    'Load the full instructions for a named skill. Call this when the user request matches a skill listed under "Available skills" in the system prompt. Returns the skill body — apply its guidance for the rest of the turn.',
  inputSchema: z.object({
    name: z.string().describe('Skill name as listed in the system prompt'),
  }),
  execute: async ({ name }) => {
    const skill = await findSkill(name);
    if (!skill) {
      const available = (await loadSkills()).map((s) => s.name);
      return {
        error: `Unknown skill: ${name}`,
        available,
      };
    }
    return { name: skill.name, description: skill.description, body: skill.body };
  },
});
