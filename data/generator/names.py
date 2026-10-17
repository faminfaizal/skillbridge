"""Fictional international name combinations. Pools are used only to compose names; no ethnicity field is stored.

The random draw (draw_name) keeps a fixed shape so the seeded world stays identical across name-pool edits:
it consumes the shared RNG in exactly the same way every time, and only the mapping from a draw to a
display name (display_name) uses the pools below. Edit the pools freely; the rest of the world will not move.
"""
import hashlib

# (given names, family names): each pool keeps a name culturally consistent
POOLS = [
    (["James", "Olivia", "Liam", "Emma", "Noah", "Charlotte", "Oliver", "Amelia", "Ethan", "Grace", "Lucas", "Chloe",
      "Daniel", "Sophie", "Ryan", "Hannah"],
     ["Smith", "Taylor", "Brown", "Wilson", "Clarke", "Walker", "Hughes", "Bennett", "Turner", "Fraser", "Murphy", "Reid"]),
    (["Wei", "Mei Ling", "Jun Hao", "Hui Min", "Zhi Hao", "Xin Yi", "Kah Wai", "Li Ting", "Jia Hui", "Yong Sheng"],
     ["Tan", "Lim", "Lee", "Wong", "Ng", "Chen", "Goh", "Chan", "Koh", "Loh"]),
    (["Arjun", "Kavitha", "Suresh", "Deepa", "Ganesh", "Anitha", "Ravi", "Shalini", "Vikram", "Meena", "Karthik", "Sangeetha"],
     ["Iyer", "Menon", "Krishnan", "Reddy", "Sharma", "Rao", "Pillai", "Patel", "Kumar", "Shetty"]),
    (["Ana", "Joao", "Mariana", "Pedro", "Ines", "Tiago", "Beatriz", "Rafael", "Carla", "Diogo"],
     ["Silva", "Santos", "Ferreira", "Costa", "Oliveira", "Pereira", "Almeida", "Rocha"]),
    (["Maria", "Jose", "Angela", "Mark", "Kristine", "Paolo", "Bianca", "Carlo", "Patricia", "Miguel"],
     ["Reyes", "Santos", "Cruz", "Bautista", "Garcia", "Mendoza", "Ramos", "Aquino", "Villanueva", "Navarro"]),
    (["Omar", "Layla", "Karim", "Nour", "Yusuf", "Amira", "Tariq", "Salma", "Faisal", "Rania", "Hafiz", "Irfan"],
     ["Haddad", "Khalil", "Nasser", "Rahman", "Aziz", "Saleh", "Hamdan", "Farouk", "Mansour", "Karimi"]),
    (["Chidi", "Amara", "Kwame", "Zainab", "Tunde", "Ngozi", "Kofi", "Ama", "Sipho", "Thandi"],
     ["Okafor", "Mensah", "Adeyemi", "Nkosi", "Boateng", "Okonkwo", "Asante", "Dlamini"]),
    (["Haruto", "Yui", "Ren", "Aoi", "Sota", "Hina", "Minjun", "Seoyeon", "Jiho", "Hayun"],
     ["Sato", "Suzuki", "Takahashi", "Tanaka", "Kim", "Park", "Choi", "Jung"]),
    (["Lukas", "Anna", "Jonas", "Lea", "Mateo", "Sofia", "Hugo", "Elena", "Pablo", "Clara"],
     ["Muller", "Schmidt", "Fischer", "Garcia", "Martinez", "Lopez", "Dubois", "Moreau", "Rossi", "Bianchi"]),
]
FAMILY_FIRST = {1}       # pool indexes written family name first
REMOTE_POOLS = [0, 4]    # remote field regions mostly hire locally from these pools

# Names reserved for story anchors; the background population never reuses them
RESERVED = {"Hafiz Rahman", "Priya Nair", "Lim Wei Ling", "Joseph Mendoza"}

# Fixed draw shape: (first threshold, sizes of the two picks) per bucket. Do not change: it fixes the RNG stream.
_REMOTE_SHARE = 0.45
_BUCKETS = [(0.55, 42, 20), (0.80, 16, 18), (0.90, 16, 10), (1.00, 12, 11)]
_REMOTE_BUCKET = 3
RESERVED_DRAWS = {(3, 0, 0)}


def draw_name(rng, remote_region: bool) -> tuple:
    """A name draw as (bucket, i, j). Consumes the RNG identically regardless of the display pools."""
    if rng.random() < _REMOTE_SHARE and remote_region:
        _, a, b = _BUCKETS[_REMOTE_BUCKET]
        return (_REMOTE_BUCKET, rng.choice(range(a)), rng.choice(range(b)))
    r = rng.random()
    for k, (limit, a, b) in enumerate(_BUCKETS):
        if r < limit:
            return (k, rng.choice(range(a)), rng.choice(range(b)))
    _, a, b = _BUCKETS[-1]
    return (len(_BUCKETS) - 1, rng.choice(range(a)), rng.choice(range(b)))


def _names(pools):
    out = []
    for p in pools:
        given, family = POOLS[p]
        out += [f"{f} {g}" if p in FAMILY_FIRST else f"{g} {f}" for g in given for f in family]
    return out


_ALL = _names(range(len(POOLS)))
_REMOTE = _names(REMOTE_POOLS)


def display_name(draw: tuple, taken: set) -> str:
    """Deterministic, collision-free display name for a draw (no RNG use)."""
    names = _REMOTE if draw[0] == _REMOTE_BUCKET else _ALL
    i = int(hashlib.sha1(repr(draw).encode()).hexdigest(), 16) % len(names)
    while names[i] in taken or names[i] in RESERVED:
        i = (i + 1) % len(names)
    return names[i]


def email_for(name: str, taken: set, domain: str) -> str:
    base = ".".join(part.lower() for part in name.split()[:2])
    base = "".join(ch for ch in base if ch.isalnum() or ch == ".")
    email, n = f"{base}@{domain}", 2
    while email in taken:
        email, n = f"{base}{n}@{domain}", n + 1
    taken.add(email)
    return email
