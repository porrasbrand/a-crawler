#!/usr/bin/env node
/**
 * Research Project Query Tool
 * Query and analyze multi-domain research crawls
 */

import { Command } from 'commander';
import { pool, closePool } from '../config/database';
import { RowDataPacket } from 'mysql2';

interface ResearchProject {
  id: number;
  name: string;
  description: string;
  industry: string;
  created_at: Date;
}

interface ProjectRun {
  run_id: string;
  batch_name: string;
  notes: string;
  total_pages_crawled: number;
  total_errors: number;
  started_at: Date;
  finished_at: Date;
}

interface PageSummary {
  final_url: string;
  title: string;
  h1: string;
  word_count: number;
  crawl_status: string;
  domain: string;
}

const program = new Command();

program
  .name('research')
  .description('Query and analyze research crawl data')
  .version('1.0.0');

// List all research projects
program
  .command('list')
  .description('List all research projects')
  .action(async () => {
    try {
      const [rows] = await pool.execute<RowDataPacket[]>(`
        SELECT rp.*,
               COUNT(DISTINCT rpr.run_id) as run_count,
               SUM(cr.total_pages_crawled) as total_pages
        FROM research_projects rp
        LEFT JOIN research_project_runs rpr ON rp.id = rpr.project_id
        LEFT JOIN crawl_runs cr ON rpr.run_id = cr.run_id
        GROUP BY rp.id
        ORDER BY rp.created_at DESC
      `);

      console.log('\n📂 Research Projects:\n');
      for (const row of rows) {
        console.log(`  ${row.name}`);
        console.log(`    Industry: ${row.industry || 'N/A'}`);
        console.log(`    Runs: ${row.run_count}, Pages: ${row.total_pages || 0}`);
        console.log(`    ${row.description || ''}`);
        console.log('');
      }
    } finally {
      await closePool();
    }
  });

// Show project details
program
  .command('show <project>')
  .description('Show details of a research project')
  .action(async (projectName: string) => {
    try {
      // Get project
      const [projects] = await pool.execute<RowDataPacket[]>(
        'SELECT * FROM research_projects WHERE name = ?',
        [projectName]
      );

      if (projects.length === 0) {
        console.error(`Project '${projectName}' not found`);
        process.exit(1);
      }

      const project = projects[0] as ResearchProject;

      // Get runs
      const [runs] = await pool.execute<RowDataPacket[]>(`
        SELECT rpr.*, cr.total_pages_crawled, cr.total_errors, cr.started_at, cr.finished_at
        FROM research_project_runs rpr
        JOIN crawl_runs cr ON rpr.run_id = cr.run_id
        WHERE rpr.project_id = ?
        ORDER BY cr.started_at
      `, [project.id]);

      console.log(`\n📂 Project: ${project.name}`);
      console.log(`   Industry: ${project.industry || 'N/A'}`);
      console.log(`   ${project.description || ''}\n`);

      console.log('📊 Crawl Runs:\n');
      let totalPages = 0;
      let totalErrors = 0;

      for (const run of runs as ProjectRun[]) {
        console.log(`  ${run.batch_name || 'unnamed'}`);
        console.log(`    Run ID: ${run.run_id}`);
        console.log(`    Pages: ${run.total_pages_crawled}, Errors: ${run.total_errors}`);
        console.log(`    Date: ${run.started_at}`);
        if (run.notes) console.log(`    Notes: ${run.notes}`);
        console.log('');
        totalPages += run.total_pages_crawled || 0;
        totalErrors += run.total_errors || 0;
      }

      console.log(`📈 Total: ${totalPages} pages crawled, ${totalErrors} errors\n`);
    } finally {
      await closePool();
    }
  });

// Get pages from a project
program
  .command('pages <project>')
  .description('List pages from a research project')
  .option('-l, --limit <number>', 'Limit results', '50')
  .option('-s, --status <status>', 'Filter by status (OK, ERROR, NOT_FOUND)')
  .option('-d, --domain <domain>', 'Filter by domain')
  .option('--export <file>', 'Export to JSON file')
  .action(async (projectName: string, options) => {
    try {
      // Get project ID
      const [projects] = await pool.execute<RowDataPacket[]>(
        'SELECT id FROM research_projects WHERE name = ?',
        [projectName]
      );

      if (projects.length === 0) {
        console.error(`Project '${projectName}' not found`);
        process.exit(1);
      }

      const projectId = projects[0].id;

      // Build query
      let query = `
        SELECT cp.final_url, cp.title, cp.h1, cp.word_count, cp.crawl_status,
               SUBSTRING_INDEX(SUBSTRING_INDEX(cp.final_url, '://', -1), '/', 1) as domain
        FROM crawler_pages cp
        JOIN research_project_runs rpr ON cp.run_id = rpr.run_id
        WHERE rpr.project_id = ?
      `;
      const params: any[] = [projectId];

      if (options.status) {
        query += ' AND cp.crawl_status = ?';
        params.push(options.status);
      }

      if (options.domain) {
        query += ' AND cp.final_url LIKE ?';
        params.push(`%${options.domain}%`);
      }

      query += ' ORDER BY cp.last_crawled_at DESC LIMIT ?';
      params.push(parseInt(options.limit, 10));

      const [rows] = await pool.execute<RowDataPacket[]>(query, params);

      if (options.export) {
        const fs = await import('fs');
        fs.writeFileSync(options.export, JSON.stringify(rows, null, 2));
        console.log(`Exported ${rows.length} pages to ${options.export}`);
      } else {
        console.log(`\n📄 Pages from ${projectName} (${rows.length} results):\n`);
        for (const row of rows as PageSummary[]) {
          const status = row.crawl_status === 'OK' ? '✅' : row.crawl_status === 'ERROR' ? '❌' : '⚠️';
          console.log(`${status} ${row.final_url}`);
          console.log(`   Title: ${row.title || 'N/A'}`);
          console.log(`   Words: ${row.word_count || 0}`);
          console.log('');
        }
      }
    } finally {
      await closePool();
    }
  });

// Domain summary
program
  .command('domains <project>')
  .description('Show domain breakdown for a project')
  .action(async (projectName: string) => {
    try {
      const [projects] = await pool.execute<RowDataPacket[]>(
        'SELECT id FROM research_projects WHERE name = ?',
        [projectName]
      );

      if (projects.length === 0) {
        console.error(`Project '${projectName}' not found`);
        process.exit(1);
      }

      const projectId = projects[0].id;

      const [rows] = await pool.execute<RowDataPacket[]>(`
        SELECT
          SUBSTRING_INDEX(SUBSTRING_INDEX(cp.final_url, '://', -1), '/', 1) as domain,
          COUNT(*) as page_count,
          SUM(CASE WHEN cp.crawl_status = 'OK' THEN 1 ELSE 0 END) as ok_count,
          SUM(CASE WHEN cp.crawl_status = 'ERROR' THEN 1 ELSE 0 END) as error_count,
          AVG(cp.word_count) as avg_words
        FROM crawler_pages cp
        JOIN research_project_runs rpr ON cp.run_id = rpr.run_id
        WHERE rpr.project_id = ?
        GROUP BY domain
        ORDER BY page_count DESC
      `, [projectId]);

      console.log(`\n🌐 Domains in ${projectName}:\n`);
      console.log('Domain                                    Pages   OK   Err   Avg Words');
      console.log('-'.repeat(75));

      for (const row of rows) {
        const domain = (row.domain as string).substring(0, 40).padEnd(40);
        const pages = String(row.page_count).padStart(5);
        const ok = String(row.ok_count).padStart(5);
        const err = String(row.error_count).padStart(5);
        const words = String(Math.round(row.avg_words || 0)).padStart(10);
        console.log(`${domain} ${pages} ${ok} ${err} ${words}`);
      }
      console.log('');
    } finally {
      await closePool();
    }
  });

// Create new project
program
  .command('create <name>')
  .description('Create a new research project')
  .option('-d, --description <desc>', 'Project description')
  .option('-i, --industry <industry>', 'Industry category')
  .action(async (name: string, options) => {
    try {
      await pool.execute(
        'INSERT INTO research_projects (name, description, industry) VALUES (?, ?, ?)',
        [name, options.description || null, options.industry || null]
      );
      console.log(`✅ Created research project: ${name}`);
    } finally {
      await closePool();
    }
  });

// Add run to project
program
  .command('add-run <project> <runId>')
  .description('Add a crawl run to a project')
  .option('-b, --batch <name>', 'Batch name')
  .option('-n, --notes <notes>', 'Notes about this run')
  .action(async (projectName: string, runId: string, options) => {
    try {
      const [projects] = await pool.execute<RowDataPacket[]>(
        'SELECT id FROM research_projects WHERE name = ?',
        [projectName]
      );

      if (projects.length === 0) {
        console.error(`Project '${projectName}' not found`);
        process.exit(1);
      }

      await pool.execute(
        'INSERT INTO research_project_runs (project_id, run_id, batch_name, notes) VALUES (?, ?, ?, ?)',
        [projects[0].id, runId, options.batch || null, options.notes || null]
      );
      console.log(`✅ Added run ${runId} to project ${projectName}`);
    } finally {
      await closePool();
    }
  });

program.parse();
