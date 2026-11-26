import { useEffect, useMemo, useState } from 'react'

/**
 * Verified local player headshot assets in `public/player-images/` keyed by
 * collapsed lowercase player name. Used as a reliable fallback whenever an
 * external CDN URL returns 403/404 or blocks hotlinking on team devices.
 */
export const LOCAL_PLAYER_IMAGE_BY_NAME: Record<string, string> = {
  'hardik pandya': '/player-images/P001.png',
  'rohit sharma': '/player-images/P002.png',
  'suryakumar yadav': '/player-images/P003.png',
  'jasprit bumrah': '/player-images/P004.png',
  'sherfane rutherford': '/player-images/P006.png',
  'naman dhir': '/player-images/P007.png',
  'will jacks': '/player-images/P008.png',
  'shardul thakur': '/player-images/P009.png',
  'trent boult': '/player-images/P010.png',
  'mitchell santner': '/player-images/P012.png',
  'quinton de kock': '/player-images/P014.png',
  'robin minz': '/player-images/P015.png',
  'deepak chahar': '/player-images/P016.png',
  'ashwani kumar': '/player-images/P017.png',
  'mayank markande': '/player-images/P018.png',
  'corbin bosch': '/player-images/P020.png',
  'danish malewar': '/player-images/P021.png',
  'atharva ankolekar': '/player-images/P022.png',
  'mayank rawat': '/player-images/P023.png',
  'raghu sharma': '/player-images/P024.png',
  'ruturaj gaikwad': '/player-images/P026.png',
  'ms dhoni': '/player-images/P028.png',
  'sarfaraz khan': '/player-images/P030.png',
  'urvil patel': '/player-images/P032.png',
  'sanju samson': '/player-images/P033.png',
  'aman khan': '/player-images/P034.png',
  'shivam dubey': '/player-images/P035.png',
  'zak foulkes': '/player-images/P036.png',
  'ramakrishna ghosh': '/player-images/P037.png',
  'anshul kamboj': '/player-images/P038.png',
  'jamie overton': '/player-images/P039.png',
  'prashant veer': '/player-images/P041.png',
  'khaleel ahmed': '/player-images/P042.png',
  'rahul chahar': '/player-images/P043.png',
  'shreyas gopal': '/player-images/P044.png',
  'matt henry': '/player-images/P045.png',
  'gurjapneet singh': '/player-images/P046.png',
  'akeal hosein': '/player-images/P047.png',
  'mukesh choudhary': '/player-images/P048.png',
  'spencer johnson': '/player-images/P049.png',
  'noor ahmad': '/player-images/P050.png',
  'ajinkya rahane': '/player-images/P052.png',
  'rinku singh': '/player-images/P053.png',
  'rahul tripathi': '/player-images/P055.png',
  'manish pandey': '/player-images/P056.png',
  'rovman powell': '/player-images/P057.png',
  'angkrish raghuvanshi': '/player-images/P058.png',
  'ramandeep singh': '/player-images/P059.png',
  'sarthak ranjan': '/player-images/P060.png',
  'tim seifert': '/player-images/P061.png',
  'daksh kamra': '/player-images/P063.png',
  'sunil narine': '/player-images/P064.png',
  'cameron green': '/player-images/P065.png',
  'rachin ravindra': '/player-images/P066.png',
  'anukul roy': '/player-images/P067.png',
  'vaibhav arora': '/player-images/P068.png',
  'kartik tyagi': '/player-images/P070.png',
  'navdeep saini': '/player-images/P071.png',
  'prashant solanki': '/player-images/P072.png',
  'umran malik': '/player-images/P073.png',
  'mustafizur rahman': '/player-images/P077.png',
  'matheesha pathirana': '/player-images/P079.png',
  'rajat patidar': '/player-images/P080.png',
  'virat kohli': '/player-images/P081.png',
  'tim david': '/player-images/P082.png',
  'phil salt': '/player-images/P084.png',
  'jitesh sharma': '/player-images/P085.png',
  'jordan cox': '/player-images/P086.png',
  'venkatesh iyer': '/player-images/P087.png',
  'krunal pandya': '/player-images/P088.png',
  'mangesh yadav': '/player-images/P089.png',
  'vihaan malhotra': '/player-images/P090.png',
  'jacob bethell': '/player-images/P091.png',
  'romario shepherd': '/player-images/P092.png',
  'kanishk chouhan': '/player-images/P093.png',
  'jacob duffy': '/player-images/P094.png',
  'josh hazlewood': '/player-images/P095.png',
  'nuwan thushara': '/player-images/P096.png',
  'bhuvneshwar kumar': '/player-images/P097.png',
  'yash dayal': '/player-images/P098.png',
  'suyash sharma': '/player-images/P099.png',
  'swapnil singh': '/player-images/P100.png',
  'vicky ostwal': '/player-images/P102.png',
  'abhinandan singh': '/player-images/P104.png',
  'shubman gill': '/player-images/P105.png',
  'sai sudharsan': '/player-images/P106.png',
  'shahrukh khan': '/player-images/P107.png',
  'jos buttler': '/player-images/P108.png',
  'anuj rawat': '/player-images/P110.png',
  'kumar kushagra': '/player-images/P111.png',
  'washington sundar': '/player-images/P112.png',
  'rahul tewatia': '/player-images/P113.png',
  'manav suthar': '/player-images/P114.png',
  'nishant sindhu': '/player-images/P115.png',
  'rashid khan': '/player-images/P116.png',
  'glenn phillips': '/player-images/P117.png',
  'jason holder': '/player-images/P118.png',
  'arshad khan': '/player-images/P119.png',
  'kulwant khejroliya': '/player-images/P121.png',
  'gurnoor brar': '/player-images/P122.png',
  'mohammed siraj': '/player-images/P123.png',
  'prasidh krishna': '/player-images/P124.png',
  'sai kishore': '/player-images/P125.png',
  'ishant sharma': '/player-images/P126.png',
  'kagiso rabada': '/player-images/P130.png',
  'riyan parag': '/player-images/P131.png',
  'shubham dubey': '/player-images/P133.png',
  'shimron hetmyer': '/player-images/P134.png',
  'yashasvi jaiswal': '/player-images/P135.png',
  'ravi singh': '/player-images/P136.png',
  'vaibhav sooryavanshi': '/player-images/P137.png',
  'dhruv jurel': '/player-images/P138.png',
  'ravindra jadeja': '/player-images/P140.png',
  'dasun shanaka': '/player-images/P142.png',
  'jofra archer': '/player-images/P144.png',
  'nandre burger': '/player-images/P145.png',
  'adam milne': '/player-images/P146.png',
  'kwena maphaka': '/player-images/P147.png',
  'vignesh puthur': '/player-images/P148.png',
  'sandeep sharma': '/player-images/P149.png',
  'brijesh sharma': '/player-images/P150.png',
  'sushant mishra': '/player-images/P151.png',
  'ravi bishnoi': '/player-images/P152.png',
  'kuldeep sen': '/player-images/P153.png',
  'yash raj punja': '/player-images/P154.png',
  'ishan kishan': '/player-images/P157.png',
  'travis head': '/player-images/P158.png',
  'heinrich klaasen': '/player-images/P161.png',
  'salil arora': '/player-images/P162.png',
  'abhishek sharma': '/player-images/P163.png',
  'shivam mavi': '/player-images/P167.png',
  'nitish kumar reddy': '/player-images/P168.png',
  'shivang kumar': '/player-images/P169.png',
  'brydon carse': '/player-images/P170.png',
  'liam livingstone': '/player-images/P171.png',
  'kamindu mendis': '/player-images/P173.png',
  'eshan malinga': '/player-images/P174.png',
  'pat cummins': '/player-images/P175.png',
  'sakib hussain': '/player-images/P177.png',
  'onkar tarmale': '/player-images/P178.png',
  'jaydev unadkat': '/player-images/P179.png',
  'zeeshan ansari': '/player-images/P180.png',
  'praful hinge': '/player-images/P181.png',
  'amit kumar': '/player-images/P182.png',
  'pyla avinash': '/player-images/P186.png',
  'nehal wadhera': '/player-images/P187.png',
  'vishnu vinod': '/player-images/P188.png',
  'marco jansen': '/player-images/P190.png',
  'marcus stoinis': '/player-images/P193.png',
  'shashank singh': '/player-images/P195.png',
  'musheer khan': '/player-images/P197.png',
  'arshdeep singh': '/player-images/P198.png',
  'yuzvendra chahal': '/player-images/P199.png',
  'harpreet brar': '/player-images/P200.png',
  'yash thakur': '/player-images/P203.png',
  'xavier bartlett': '/player-images/P205.png',
  'ben dwarshuis': '/player-images/P206.png',
  'lockie ferguson': '/player-images/P207.png',
  'axar patel': '/player-images/P208.png',
  'prithvi shaw': '/player-images/P209.png',
  'pathum nissanka': '/player-images/P210.png',
  'david miller': '/player-images/P211.png',
  'karun nair': '/player-images/P212.png',
  'nitish rana': '/player-images/P214.png',
  'kl rahul': '/player-images/P216.png',
  'ben duckett': '/player-images/P217.png',
  'tristan stubbs': '/player-images/P218.png',
  'sameer rizvi': '/player-images/P219.png',
  'ashutosh sharma': '/player-images/P220.png',
  'madhav tiwari': '/player-images/P222.png',
  'vipraj nigam': '/player-images/P223.png',
  'tripurana vijay': '/player-images/P224.png',
  'mukesh kumar': '/player-images/P225.png',
  'kuldeep yadav': '/player-images/P226.png',
  'auqib nabi': '/player-images/P227.png',
  'kyle jamieson': '/player-images/P228.png',
  'dushmantha chameera': '/player-images/P229.png',
  'mitchell starc': '/player-images/P231.png',
  'rishabh pant': '/player-images/P233.png',
  'nicholas pooran': '/player-images/P234.png',
  'josh inglis': '/player-images/P235.png',
  'himmat singh': '/player-images/P236.png',
  'ayush badoni': '/player-images/P237.png',
  'matthew breetzke': '/player-images/P239.png',
  'mukul choudhary': '/player-images/P241.png',
  'abdul samad': '/player-images/P242.png',
  'mitchell marsh': '/player-images/P243.png',
  'arshin kulkarni': '/player-images/P244.png',
  'akash singh': '/player-images/P247.png',
  'avesh khan': '/player-images/P248.png',
  'prince yadav': '/player-images/P250.png',
  'naman tiwari': '/player-images/P251.png',
  'mayank yadav': '/player-images/P252.png',
  'arjun tendulkar': '/player-images/P254.png',
  'mohsin khan': '/player-images/P255.png',
  'anrich nortje': '/player-images/P257.png',
}

function normalizePlayerNameKey(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function isRealPlayerMediaUrl(url: string): boolean {
  return /(iplt20\.com|delhicapitals\.in|punjabkingsipl\.in|gujarattitansipl\.com|lucknowsupergiants\.in|kkr\.in|rajasthanroyals\.com|royalchallengers\.com|chennaisuperkings\.com|mumbaiindians\.com|sunrisershyderabad\.in|toiimg\.com|hscicdn\.com|supabase\.co|\/player-images\/)/i.test(
    url,
  )
}

export function resolvePlayerImageCandidates(
  name: string | null | undefined,
  photoUrl: string | null | undefined,
): string[] {
  const trimmed = typeof photoUrl === 'string' ? photoUrl.trim() : ''
  if (!trimmed) return []

  const candidates: string[] = [trimmed]
  const pushUnique = (url: string | null | undefined) => {
    const val = typeof url === 'string' ? url.trim() : ''
    if (val && !candidates.includes(val)) {
      candidates.push(val)
    }
  }

  const match = trimmed.match(/(P\d+\.(?:png|jpg|jpeg|webp))$/i)
  if (match) {
    pushUnique(`/player-images/${match[1]}`)
  }

  if (isRealPlayerMediaUrl(trimmed)) {
    const localByName = LOCAL_PLAYER_IMAGE_BY_NAME[normalizePlayerNameKey(name)]
    if (localByName) {
      pushUnique(localByName)
      const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/+$/, '')
      if (supabaseUrl) {
        const file = localByName.replace(/^\/player-images\//, '')
        pushUnique(`${supabaseUrl}/storage/v1/object/public/player-images/${file}`)
      }
    }
  }

  return candidates
}

/**
 * Shared React hook that resolves a player's image URL with automatic fallback
 * across external URLs and cached local `/player-images/` assets.
 */
export function usePlayerImage(
  name: string | null | undefined,
  photoUrl: string | null | undefined,
): { src: string | null; onError: () => void } {
  const candidates = useMemo(
    () => resolvePlayerImageCandidates(name, photoUrl),
    [name, photoUrl],
  )
  const [index, setIndex] = useState(0)

  useEffect(() => {
    setIndex(0)
  }, [name, photoUrl])

  return {
    src: candidates[index] ?? null,
    onError: () => setIndex((current) => current + 1),
  }
}
