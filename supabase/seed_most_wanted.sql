-- Gielinor's Most Wanted — sample Most Wanted contracts
-- These need reputation to claim and appear in the Most Wanted slots, not the main board.
-- Adding them to the pool fills any empty Most Wanted slot automatically.

insert into public.contracts
  (title, category, difficulty, summary, description, requirements, restrictions, evidence_instructions, min_reputation, pool_order, status)
values
('The Warden''s Fall', 'pvm', 'elite',
 'Defeat Telos, the Warden once.',
 'Telos guards the heart of Gielinor. Only proven hunters are sent after him.',
 'Access to the Telos encounter.', 'Any enrage counts.',
 'Kill message or loot screenshot, codeword typed in clan chat.', 250, 10, 'pool'),
('Angel of Death', 'pvm', 'elite',
 'Defeat Nex: Angel of Death once.',
 'The Angel of Death stirs in the Ancient Prison. Bring your best team.',
 'Access to Nex: Angel of Death.', 'Group kills count for every member who submits.',
 'Kill or reward screenshot showing you in the group, codeword typed in clan chat.', 250, 20, 'pool'),
('Master Tracker', 'special', 'elite',
 'Complete 3 master clue scrolls.',
 'Three master trails, back to back. Only the most dedicated need apply.',
 '', '',
 'The reward casket screen for each of the 3 clues, codeword typed in clan chat.', 250, 30, 'pool'),
('Grove Guardian', 'pvm', 'elite',
 'Defeat Solak once.',
 'Solak has poisoned the elven lands. End it.',
 'Access to Solak.', 'Group kills count for every member who submits.',
 'Kill or reward screenshot showing you in the group, codeword typed in clan chat.', 450, 40, 'pool');
