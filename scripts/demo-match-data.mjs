/** Synthetic pet records for the connected demo database. */
function yearsAgo(years, months = 0) {
  const date = new Date()
  date.setUTCMonth(date.getUTCMonth() - years * 12 - months)
  return date.toISOString().slice(0, 10)
}

export const DEMO_PETS = [
  {
    slug: 'demoluna', name: 'Luna (demo)', species: 'dog', sex: 'female', size: 'medium',
    birthDate: yearsAgo(2), breed: 'Mixed breed', color: 'Tan', photo: 'luna.webp',
    about: 'Demo pet for matching practice. Gentle and people-oriented; enjoys calm company and daily walks.',
    traits: { activity_level: 3, temperament: 'calm', child_compatible: true, pet_compatible: true, space_need: 3, time_need: 3, experience_need: 2 }
  },
  {
    slug: 'demobrun', name: 'Bruno (demo)', species: 'dog', sex: 'male', size: 'large',
    birthDate: yearsAgo(5), breed: 'Mixed breed', color: 'Brown', photo: 'bruno.webp',
    about: 'Demo pet for matching practice. Affectionate and active; does best with ample space and exercise.',
    traits: { activity_level: 4, temperament: 'friendly', child_compatible: true, pet_compatible: false, space_need: 5, time_need: 4, experience_need: 4 }
  },
  {
    slug: 'demomilo', name: 'Milo (demo)', species: 'cat', sex: 'male', size: 'small',
    birthDate: yearsAgo(0, 10), breed: 'Domestic shorthair', color: 'Orange', photo: 'milo.webp',
    about: 'Demo pet for matching practice. Curious and playful, with a good fit for indoor living.',
    traits: { activity_level: 4, temperament: 'playful', child_compatible: true, pet_compatible: true, space_need: 2, time_need: 3, experience_need: 2 }
  },
  {
    slug: 'demococo', name: 'Coco (demo)', species: 'cat', sex: 'female', size: 'small',
    birthDate: yearsAgo(4), breed: 'Domestic shorthair', color: 'Black', photo: 'coco.webp',
    about: 'Demo pet for matching practice. Quiet and independent; suited to a calmer household.',
    traits: { activity_level: 2, temperament: 'independent', child_compatible: true, pet_compatible: false, space_need: 1, time_need: 2, experience_need: 1 }
  },
  {
    slug: 'demopepr', name: 'Pepper (demo)', species: 'dog', sex: 'female', size: 'small',
    birthDate: yearsAgo(0, 8), breed: 'Mixed breed', color: 'White and brown', photo: 'pepper.webp',
    about: 'Demo pet for matching practice. Energetic and social; loves attention and games.',
    traits: { activity_level: 5, temperament: 'playful', child_compatible: true, pet_compatible: true, space_need: 2, time_need: 4, experience_need: 2 }
  },
  {
    slug: 'demomoch', name: 'Mochi (demo)', species: 'cat', sex: 'female', size: 'small',
    birthDate: yearsAgo(2), breed: 'Domestic shorthair', color: 'Cream', photo: null,
    about: 'Demo pet for matching practice. Calm indoor companion who enjoys gentle play and quiet homes.',
    traits: { activity_level: 2, temperament: 'calm', child_compatible: true, pet_compatible: true, space_need: 1, time_need: 2, experience_need: 1 }
  },
  {
    slug: 'demomaxx', name: 'Max (demo)', species: 'dog', sex: 'male', size: 'large',
    birthDate: yearsAgo(3), breed: 'Mixed breed', color: 'Brown', photo: null,
    about: 'Demo pet for matching practice. Alert, protective companion suited to an experienced household.',
    traits: { activity_level: 5, temperament: 'protective', child_compatible: false, pet_compatible: false, space_need: 5, time_need: 5, experience_need: 5 }
  },
  {
    slug: 'demooreo', name: 'Oreo (demo)', species: 'cat', sex: 'male', size: 'medium',
    birthDate: yearsAgo(8), breed: 'Domestic shorthair', color: 'Black and white', photo: null,
    about: 'Demo pet for matching practice. Independent senior cat who prefers a quiet home and a steady routine.',
    traits: { activity_level: 1, temperament: 'independent', child_compatible: false, pet_compatible: true, space_need: 2, time_need: 2, experience_need: 2 }
  },
  {
    slug: 'demobell', name: 'Bella (demo)', species: 'dog', sex: 'female', size: 'small',
    birthDate: yearsAgo(7), breed: 'Mixed breed', color: 'White', photo: null,
    about: 'Demo pet for matching practice. Friendly senior dog who enjoys short walks and close company.',
    traits: { activity_level: 2, temperament: 'friendly', child_compatible: true, pet_compatible: true, space_need: 2, time_need: 3, experience_need: 1 }
  },
  {
    slug: 'demonala', name: 'Nala (demo)', species: 'cat', sex: 'female', size: 'small',
    birthDate: yearsAgo(0, 6), breed: 'Domestic shorthair', color: 'Orange', photo: null,
    about: 'Demo pet for matching practice. Playful kitten who needs daily games, attention and patient care.',
    traits: { activity_level: 5, temperament: 'playful', child_compatible: true, pet_compatible: true, space_need: 2, time_need: 4, experience_need: 2 }
  }
]

/**
 * Exhaustive synthetic coverage for the form: 2 species × 3 sizes × 4 ages ×
 * 5 temperaments × 5 activity levels = 600 distinct pets. Care needs of 1 and
 * both household flags true deliberately cover every valid capacity answer.
 * These are test fixtures, not real assessments or adoption offers.
 */
export const DEMO_COVERAGE_PETS = []
const ageDates = { baby: yearsAgo(0, 6), young: yearsAgo(2), adult: yearsAgo(5), senior: yearsAgo(9) }
const names = ['Aster', 'Basil', 'Cedar', 'Daisy', 'Echo', 'Fern', 'Hazel', 'Indigo', 'Juniper', 'Maple', 'Olive', 'Willow']
for (const species of ['dog', 'cat']) {
  for (const size of ['small', 'medium', 'large']) {
    for (const [ageGroup, birthDate] of Object.entries(ageDates)) {
      for (const temperament of ['calm', 'friendly', 'playful', 'independent', 'protective']) {
        for (let activity = 1; activity <= 5; activity++) {
          const index = DEMO_COVERAGE_PETS.length
          const number = String(index + 1).padStart(3, '0')
          DEMO_COVERAGE_PETS.push({
            slug: `dmx${String(index + 1).padStart(5, '0')}`,
            name: `${names[index % names.length]} (demo ${number})`, species,
            sex: index % 2 ? 'male' : 'female', size, birthDate,
            breed: species === 'cat' ? 'Domestic mix' : 'Mixed breed', color: 'Not recorded', photo: null,
            about: `Synthetic matching-test pet: ${size} ${species}, ${ageGroup}, ${temperament}, activity ${activity}/5. Demo care requirements are set to 1/5 with child and pet compatibility for form testing. These are not real care or behavior assessments.`,
            traits: { activity_level: activity, temperament, child_compatible: true, pet_compatible: true,
              space_need: 1, time_need: 1, experience_need: 1 }
          })
        }
      }
    }
  }
}

