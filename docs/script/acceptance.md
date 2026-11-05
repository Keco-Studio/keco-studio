# Document-to-Script acceptance

Local acceptance used DeepSeek Flash and PixelLab against an isolated local
Supabase project. Credentials, database identifiers, temporary scripts and generated
artwork are not included in the repository.

- A free-form rainy-platform story converted through the sidebar's Generate
  conversation action. Its title, scene narration, five dialogue lines, two
  profiles and two independent endings survived conversion and source writeback.
- The browser displayed Dialogue and Blueprint-style Flow Chart without graph
  diagnostics. Profiles were extracted from source, two reference sprites were
  generated, and seven shots received directions and artwork.
- Both Shot Script Preview choices were clicked through to their exact endings.
  The exported standalone HTML was independently replayed on both branches.
- Visual review rejected the initial reference images because their clothing did
  not match the Chinese profiles. Translating only the drawing prompt to English
  fixed the observed clothing mismatch while retaining the original profiles.
- A second free-form story of 4,497 characters, four characters and three
  independent endings converted on the first model attempt into 89 rows. All
  speakers and options were present, source was synchronized, and graph diagnostics
  were empty.

These samples do not prove support for every document format. Cross-device shot
asset persistence and character action animation remain outside this implementation.
