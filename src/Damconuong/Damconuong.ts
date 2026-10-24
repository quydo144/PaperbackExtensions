import {
    BadgeColor,
    Chapter,
    ChapterDetails,
    ChapterProviding,
    ContentRating,
    DUISection,
    HomePageSectionsProviding,
    HomeSection,
    HomeSectionType,
    MangaProviding,
    PagedResults,
    PartialSourceManga,
    Request,
    Response,
    SearchRequest,
    SearchResultsProviding,
    SourceInfo,
    SourceIntents,
    SourceManga
} from "@paperback/types";

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { loadEncryptedPages } from "./encryptedPageLoader";
import { DamCoNuongMetadata } from "./model";

const BASE_URL = "https://damconuong.win";

export const DamconuongInfo: SourceInfo = {
    version: "1.0",
    name: "Dâm Cô Nương",
    description: `Extension that pulls content from ${BASE_URL}`,
    author: "Kizias",
    icon: "icon.png",
    contentRating: ContentRating.ADULT,
    websiteBaseURL: BASE_URL,
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS | SourceIntents.CLOUDFLARE_BYPASS_REQUIRED
        | SourceIntents.SETTINGS_UI,
    sourceTags: [
        {
            text: '18+',
            type: BadgeColor.RED
        }
    ]
};

export class Damconuong implements ChapterProviding, HomePageSectionsProviding, MangaProviding, SearchResultsProviding {
    private readonly cookieKey = "request_cookie";
    private readonly stateManager = App.createSourceStateManager();

    requestManager = App.createRequestManager({
        requestsPerSecond: 5,
        requestTimeout: 20000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                const storedCookie = await this.stateManager.keychain.retrieve(this.cookieKey);
                const cookie = typeof storedCookie === "string" ? storedCookie.trim() : "";

                request.headers = {
                    "Referer": `${BASE_URL}/`,
                    "Origin": `${BASE_URL}/`,
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    ...(request.headers ?? {}),
                    ...(cookie ? { "Cookie": cookie } : {})
                };
                return request;
            },
            interceptResponse: async (response: Response): Promise<Response> => {
                return response;
            },
        },
    });

    async getSourceMenu(): Promise<DUISection> {
        const storedCookie = await this.stateManager.keychain.retrieve(this.cookieKey);
        const hasCookie = typeof storedCookie === "string" && storedCookie.trim().length > 0;

        return App.createDUISection({
            id: "cookie_settings",
            header: "Cookie",
            footer: "Cookie được lưu bảo mật trên thiết bị và tự động gửi kèm mỗi request.",
            isHidden: false,
            rows: async () => [
                App.createDUILabel({
                    id: "cookie_status",
                    label: "Trạng thái",
                    value: hasCookie ? "Đã lưu Cookie" : "Chưa lưu Cookie"
                }),
                App.createDUINavigationButton({
                    id: "cookie_settings_button",
                    label: "Nhập / cập nhật Cookie",
                    form: App.createDUIForm({
                        sections: async () => [
                            App.createDUISection({
                                id: "cookie_input_section",
                                header: "Cookie",
                                footer: "Dán toàn bộ chuỗi Cookie vào ô phía trên.",
                                isHidden: false,
                                rows: async () => [
                                    App.createDUISecureInputField({
                                        id: this.cookieKey,
                                        label: "Cookie",
                                        value: App.createDUIBinding({
                                            get: async () => {
                                                return await this.stateManager.keychain.retrieve(this.cookieKey) ?? "";
                                            },
                                            set: async (newValue: unknown) => {
                                                const cookie = typeof newValue === "string" ? newValue.trim() : "";
                                                await this.stateManager.keychain.store(this.cookieKey, cookie);
                                            }
                                        })
                                    })
                                ]
                            })
                        ],
                        onSubmit: async () => { return; }
                    })
                })
            ]
        });
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        const sections: HomeSection[] = [
            App.createHomeSection({
                id: "hot_daily_section",
                title: "Truyện Hot Ngày",
                type: HomeSectionType.featured,
                containsMoreItems: false,
            }),
            App.createHomeSection({
                id: "original_series_section",
                title: "Truyện Nhà Làm",
                type: HomeSectionType.singleRowNormal,
                containsMoreItems: true
            }),
            App.createHomeSection({
                id: "manga_list_section",
                title: "Danh Sách Truyện",
                type: HomeSectionType.singleRowNormal,
                containsMoreItems: true,
            })
        ];

        for (const section of sections) {
            sectionCallback(section);
        }

        const hotDailyItems = await this.getMangaListHotDailyItems(undefined);
        const originalSeriesItems = await this.getMangaListUpdateItems('/nhom-dich/dam-co-nuong', undefined);
        const mangaListItems = await this.getMangaListUpdateItems('/danh-sach', undefined);

        for (const section of sections) {
            switch (section.id) {
                case "hot_daily_section":
                    section.items = hotDailyItems.results;
                    break;
                case "original_series_section":
                    section.items = originalSeriesItems.results;
                    break;
                case "manga_list_section":
                    section.items = mangaListItems.results;
                    break;
            }
            sectionCallback(section);
        }
    }

    async getViewMoreItems(sectionId: string, metadata: DamCoNuongMetadata | undefined): Promise<PagedResults> {
        switch (sectionId) {
            case "original_series_section":
                return this.getMangaListUpdateItems('/nhom-dich/dam-co-nuong', metadata);
            case "manga_list_section":
                return this.getMangaListUpdateItems('/danh-sach', metadata);
            default:
                return App.createPagedResults({ results: [] });
        }
    }

    private async getMangaListUpdateItems(category: string, metadata: DamCoNuongMetadata | undefined): Promise<PagedResults> {
        const page = metadata?.page ?? 1;
        const collectedIds = metadata?.collectedIds ?? [];

        const response = await this.requestManager.schedule(App.createRequest({
            url: `${BASE_URL}${category}?page=${page}`,
            method: "GET"
        }), 1);

        const $ = cheerio.load(response.data as string);

        const parsed = this.parseMangaItems($, $('main .grid .w-full'), collectedIds);

        const nextPageHref = $('nav[aria-label="Pagination"] a[aria-label="Next"]').first().attr("href") || "";
        const nextPage = Number(nextPageHref.match(/[?&]page=(\d+)/)?.[1] || 0);
        const hasNextPage = nextPage > page;

        return App.createPagedResults({
            results: parsed.items,
            metadata: hasNextPage ? { page: nextPage, collectedIds: parsed.collectedIds } : undefined,
        });
    }

    private async getMangaListHotDailyItems(metadata: DamCoNuongMetadata | undefined): Promise<PagedResults> {

        const collectedIds = metadata?.collectedIds ?? [];

        const response = await this.requestManager.schedule(App.createRequest({
            url: `${BASE_URL}`,
            method: "GET"
        }), 1);

        const $ = cheerio.load(response.data as string);

        const hotDailySection = $("main section").filter((_, section) => {
            return $(section).find("h2").first().text().trim() === "Truyện Hot Ngày";
        }).first();

        const parsed = this.parseMangaItems($, hotDailySection.find(".w-full"), collectedIds);

        return App.createPagedResults({
            results: parsed.items,
            metadata: undefined,
        });
    }

    private parseMangaItems<T extends AnyNode>(
        $: cheerio.CheerioAPI,
        elements: cheerio.Cheerio<T>,
        collectedIds: string[] = []
    ): { items: PartialSourceManga[], collectedIds: string[] } {
        const items: PartialSourceManga[] = [];
        const seen = new Set<string>(collectedIds);

        elements.each((_, element) => {
            const el = $(element);

            const mangaLink = el.find('h3 a[href*="/truyen/"]').first();
            const title = mangaLink.text().trim();
            const mangaUrl = mangaLink.attr("href") || "";
            const latestChapter = el.find("h4 a").first().text().trim();
            const cover = el.find(".cover-frame img").first();
            const image = cover.attr("data-src") || cover.attr("src") || "";
            const mangaId = mangaUrl.match(/\/truyen\/([^/?#]+)/)?.[1] || "";

            if (!mangaId || !title || !image || seen.has(mangaId)) return;

            seen.add(mangaId);
            items.push(App.createPartialSourceManga({
                mangaId,
                title,
                image,
                subtitle: latestChapter || undefined,
            }));
        });

        return { items, collectedIds: Array.from(seen) };
    }

    async getSearchResults(query: SearchRequest, metadata: DamCoNuongMetadata | undefined): Promise<PagedResults> {
        const collectedIds: string[] = metadata?.collectedIds ?? [];
        const page: number = metadata?.page ?? 1;
        const searchTerm = query.title ?? "";

        if (!searchTerm.trim()) {
            return App.createPagedResults({ results: [] });
        }

        const response = await this.requestManager.schedule(
            App.createRequest({
                url: `${BASE_URL}/tim-kiem?filter[name]=${encodeURIComponent(searchTerm)}&sort=-updated_at&page=${page}`,
                method: "GET"
            }), 1
        );
        const $ = cheerio.load(response.data as string);

        const parsed = this.parseMangaItems($, $("main section .w-full"), collectedIds);

        const nextPageHref = $('nav[aria-label="Pagination"] a[aria-label="Next"]').first().attr("href") || "";
        const nextPage = Number(nextPageHref.match(/[?&]page=(\d+)/)?.[1] || 0);
        const hasNextPage = nextPage > page;

        return App.createPagedResults({
            results: parsed.items,
            metadata: hasNextPage ? {
                page: nextPage,
                collectedIds: parsed.collectedIds
            } : undefined,
        });
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const response = await this.requestManager.schedule(
            App.createRequest({
                url: `${BASE_URL}/truyen/${mangaId}`,
                method: "GET",
            }), 1
        );

        const $ = cheerio.load(response.data as string);
        const title = $(".md-title").first().text().trim();
        const rawImage = $(".md-cover img").first().attr("src")?.trim() || "";
        const image = rawImage ? encodeURI(rawImage) : "";
        const description = $(".md-synopsis p[x-ref='text']").first().text().trim();
        return App.createSourceManga({
            id: mangaId,
            mangaInfo: App.createMangaInfo({
                titles: [title],
                image,
                desc: description,
                author: "N/A",
                artist: "N/A",
                status: "N/A",
                tags: [],
            }),
        });
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const response = await this.requestManager.schedule(App.createRequest({
            url: `${BASE_URL}/truyen/${mangaId}`,
            method: "GET"
        }), 1);
        const $ = cheerio.load(response.data as string);

        const chapters: Chapter[] = [];
        const seen = new Set<string>();

        $('#md-chapter-list li a.md-ch[href]').each((_, element) => {
            const chapterLink = $(element);
            const chapterUrl = chapterLink.attr("href") || "";
            const chapterId = chapterUrl.replace(/\/$/, "").split("/").pop() || "";
            const chapterTitle = chapterLink.find(".md-ch-title").first().text().trim();
            const chapNumMatch = chapterTitle.match(/(\d+(?:\.\d+)?)/);
            const chapNum = chapNumMatch ? Number(chapNumMatch[1]) : 0;

            if (!chapterId || !chapterTitle || seen.has(chapterId)) return;
            seen.add(chapterId);

            chapters.push(App.createChapter({
                id: chapterId,
                name: chapterTitle,
                chapNum: chapNum
            }));
        });

        return chapters;
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const encryptedPages = await loadEncryptedPages(
            `${mangaId}/${chapterId}`,
            async (path, headers) => {
                const response = await this.requestManager.schedule(App.createRequest({
                    url: `${BASE_URL}${path}`,
                    method: "GET",
                    headers,
                }), 1);
                const responseData = response.data;

                if (typeof responseData !== "string") {
                    throw new Error("Empty encrypted page response");
                }

                return JSON.parse(responseData) as { e?: unknown };
            }
        );

        return App.createChapterDetails({
            id: chapterId,
            mangaId: mangaId,
            pages: encryptedPages.map((page) => page.src),
        });
    }
}
