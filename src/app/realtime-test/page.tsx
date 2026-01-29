'use client';

import { useEffect, useState } from 'react';
import { useSupabase } from '@/lib/SupabaseContext';

export default function RealtimeTestPage() {
  const supabase = useSupabase();
  const [logs, setLogs] = useState<string[]>([]);
  const [isSubscribed, setIsSubscribed] = useState(false);
  
  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [`[${timestamp}] ${message}`, ...prev].slice(0, 50));
  };

  useEffect(() => {
    addLog('🔄 Setting up test subscriptions...');
    
    // Test libraries table
    const librariesChannel = supabase
      .channel('test-libraries')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'libraries',
        },
        (payload) => {
          addLog(`✅ LIBRARIES change detected: ${payload.eventType}`);
          console.log('Libraries payload:', payload);
        }
      )
      .subscribe((status, err) => {
        addLog(`Libraries subscription status: ${status}`);
        if (err) addLog(`❌ Libraries error: ${err.message}`);
        if (status === 'SUBSCRIBED') setIsSubscribed(true);
      });

    // Test folders table
    const foldersChannel = supabase
      .channel('test-folders')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'folders',
        },
        (payload) => {
          addLog(`✅ FOLDERS change detected: ${payload.eventType}`);
          console.log('Folders payload:', payload);
        }
      )
      .subscribe((status, err) => {
        addLog(`Folders subscription status: ${status}`);
        if (err) addLog(`❌ Folders error: ${err.message}`);
      });

    // Test predefine_properties table
    const predefinePropertiesChannel = supabase
      .channel('test-predefine-properties')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'predefine_properties',
        },
        (payload) => {
          addLog(`✅ PREDEFINE_PROPERTIES change detected: ${payload.eventType}`);
          console.log('Predefine properties payload:', payload);
        }
      )
      .subscribe((status, err) => {
        addLog(`Predefine properties subscription status: ${status}`);
        if (err) addLog(`❌ Predefine properties error: ${err.message}`);
      });

    return () => {
      addLog('🔄 Cleaning up subscriptions...');
      supabase.removeChannel(librariesChannel);
      supabase.removeChannel(foldersChannel);
      supabase.removeChannel(predefinePropertiesChannel);
    };
  }, [supabase]);

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Supabase Realtime Test</h1>
      <div style={{ 
        backgroundColor: isSubscribed ? '#d4edda' : '#f8d7da', 
        color: isSubscribed ? '#155724' : '#721c24',
        padding: '10px', 
        borderRadius: '5px',
        marginBottom: '20px'
      }}>
        <strong>Status:</strong> {isSubscribed ? '✅ Connected' : '⏳ Connecting...'}
      </div>
      
      <div style={{ marginBottom: '20px' }}>
        <h2>Instructions:</h2>
        <ol>
          <li>Open this page in TWO different browsers/tabs</li>
          <li>In one browser, go to a project and modify:
            <ul>
              <li>Create/delete a library</li>
              <li>Create/delete a folder</li>
              <li>Modify predefine (add/delete section or property)</li>
            </ul>
          </li>
          <li>Watch the logs below - you should see events appear in BOTH browsers</li>
        </ol>
      </div>

      <div style={{ marginBottom: '10px' }}>
        <button 
          onClick={() => setLogs([])}
          style={{ 
            padding: '8px 16px', 
            backgroundColor: '#007bff', 
            color: 'white', 
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Clear Logs
        </button>
      </div>

      <div style={{ 
        backgroundColor: '#f5f5f5', 
        padding: '15px', 
        borderRadius: '5px',
        maxHeight: '500px',
        overflow: 'auto',
        fontFamily: 'monospace',
        fontSize: '12px'
      }}>
        <h3>Event Logs:</h3>
        {logs.length === 0 ? (
          <p style={{ color: '#666' }}>Waiting for events...</p>
        ) : (
          logs.map((log, index) => (
            <div key={index} style={{ marginBottom: '5px' }}>
              {log}
            </div>
          ))
        )}
      </div>

      <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#fff3cd', borderRadius: '5px' }}>
        <h3>⚠️ If you don't see any events:</h3>
        <ol>
          <li>在本地Supabase Studio中运行SQL:</li>
          <li>
            <pre style={{ backgroundColor: '#f0f0f0', padding: '10px', borderRadius: '4px', fontSize: '11px' }}>
{`ALTER PUBLICATION supabase_realtime ADD TABLE public.libraries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.folders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.predefine_properties;
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_collaborators;`}
            </pre>
          </li>
          <li>运行后刷新此页面</li>
        </ol>
      </div>
    </div>
  );
}

