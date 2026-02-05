import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

interface TmdbMovieResult {
  id: number;
  title: string;
  release_date?: string;
  vote_average?: number;
  overview?: string;
  poster_path?: string | null;
}

interface TmdbSearchResponse {
  results: TmdbMovieResult[];
}

export interface MovieSearchItem {
  title: string;
  year: string;
  rating: string;
  overview: string;
  posterUrl: string | null;
}

@Injectable()
export class MovieService {
  private readonly apiKey = process.env.TMDB_API_KEY ?? '';
  private readonly language = process.env.TMDB_LANGUAGE ?? 'en-US';
  private readonly region = process.env.TMDB_REGION ?? '';
  private readonly client: AxiosInstance;
  private readonly cache = new Map<
    string,
    { expiresAt: number; items: MovieSearchItem[] }
  >();
  private readonly cacheTtlMs = 10 * 60 * 1000;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://api.themoviedb.org/3',
      timeout: 8000,
    });
  }

  async searchMovies(query: string): Promise<MovieSearchItem[]> {
    const cleaned = query.trim();
    if (!cleaned) return [];
    if (!this.apiKey) {
      throw new Error('TMDB_API_KEY_MISSING');
    }

    const cacheKey = cleaned.toLowerCase();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.items;
    }

    const response = await this.client.get<TmdbSearchResponse>(
      '/search/movie',
      {
        params: {
          api_key: this.apiKey,
          query: cleaned,
          include_adult: false,
          language: this.language,
          region: this.region || undefined,
        },
      },
    );

    const items = (response.data.results ?? []).slice(0, 5).map((movie) => {
      const year = movie.release_date?.slice(0, 4) ?? 'N/A';
      const rating =
        typeof movie.vote_average === 'number'
          ? movie.vote_average.toFixed(1)
          : 'N/A';
      const posterUrl = movie.poster_path
        ? `https://image.tmdb.org/t/p/w342${movie.poster_path}`
        : null;
      return {
        title: movie.title,
        year,
        rating,
        overview: movie.overview ?? '',
        posterUrl,
      };
    });

    this.cache.set(cacheKey, {
      expiresAt: Date.now() + this.cacheTtlMs,
      items,
    });

    return items;
  }
}
