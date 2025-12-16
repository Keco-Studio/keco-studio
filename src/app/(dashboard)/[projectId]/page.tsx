'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { getProject, Project } from '@/lib/services/projectService';
import { listLibraries, Library } from '@/lib/services/libraryService';
import predefineSettingIcon from "@/app/assets/images/predefineSettingIcon.svg";
import Image from 'next/image';

export default function ProjectPage() {
  const params = useParams();
  const supabase = useSupabase();
  const projectId = params.projectId as string;
  
  const [project, setProject] = useState<Project | null>(null);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!projectId) return;
      
      setLoading(true);
      setError(null);
      
      try {
        const [projectData, librariesData] = await Promise.all([
          getProject(supabase, projectId),
          listLibraries(supabase, projectId),
        ]);
        
        if (!projectData) {
          setError('Project not found');
          return;
        }
        
        setProject(projectData);
        setLibraries(librariesData);
      } catch (e: any) {
        setError(e?.message || 'Failed to load project');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [projectId, supabase]);

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div>Loading project...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div style={{ color: '#dc2626' }}>{error}</div>
      </div>
    );
  }

  if (!project) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div>Project not found</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#0f172a', marginBottom: '1rem' }}>
          Libraries
        </h2>
        {libraries.length === 0 ? (
          <div style={{ color: '#64748b', padding: '1rem', background: '#f8fafc', borderRadius: '8px' }}>
            No libraries in this project yet.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {libraries.map((library) => (
              <div
                key={library.id}
                style={{
                  padding: '12px 14px',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  background: 'white',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div style={{ fontWeight: 600, color: '#0f172a' }}>{library.name}</div>
                {library.description && (
                  <div style={{ color: '#475569', fontSize: '14px', marginTop: '4px' }}>
                    {library.description}
                  </div>
                )}
                <Image src={predefineSettingIcon} alt="predefineSettingIcon" width={25} height={25} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

