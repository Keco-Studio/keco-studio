'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { getProject, Project } from '@/lib/services/projectService';
import { listLibraries, Library } from '@/lib/services/libraryService';
import predefineSettingIcon from "@/app/assets/images/predefineSettingIcon.svg";
import Image from 'next/image';
import styles from './page.module.css';

export default function ProjectPage() {
  const params = useParams();
  const router = useRouter();
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
      <div className={styles.loadingContainer}>
        <div>Loading project...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.errorContainer}>
        <div className={styles.errorText}>{error}</div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className={styles.notFoundContainer}>
        <div>Project not found</div>
      </div>
    );
  }

  const handleLibraryPredefineClick = (libraryId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/${projectId}/${libraryId}/predefine`);
  };

  return (
    <div className={styles.container}>
      <div>
        <h2 className={styles.sectionTitle}>
          Libraries
        </h2>
        {libraries.length === 0 ? (
          <div className={styles.emptyLibraries}>
            No libraries in this project yet.
          </div>
        ) : (
          <div className={styles.librariesGrid}>
            {libraries.map((library) => (
              <div
                key={library.id}
                className={styles.libraryCard}
              >
                <div className={styles.libraryInfo}>
                  <div className={styles.libraryName}>{library.name}</div>
                  {library.description && (
                    <div className={styles.libraryDescription}>
                      {library.description}
                    </div>
                  )}
                </div>
                <button
                  onClick={(e) => handleLibraryPredefineClick(library.id, e)}
                  className={styles.settingsButton}
                  aria-label="Library sections settings"
                >
                  <Image src={predefineSettingIcon} alt="predefineSettingIcon" width={25} height={25} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

